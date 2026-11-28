// Shared HTTP plumbing for AI providers. Every provider speaks JSON over
// HTTPS; this module turns transport failures into typed errors the router
// can act on (cool down, disable, or try the next provider).
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class ProviderQuotaError extends Error {
  readonly retryAfterMs: number | null

  constructor(message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = "ProviderQuotaError"
    this.retryAfterMs = retryAfterMs
  }
}

export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderAuthError"
  }
}

export class ProviderRequestError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = "ProviderRequestError"
    this.status = status
  }
}

/** Retry-After as milliseconds; accepts delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)

  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

/**
 * Parse rate-limit reset durations from headers like x-ratelimit-reset-tokens or
 * x-ratelimit-reset-requests, e.g. "9.172s", "6m0s", "250ms", "1s".
 */
export function parseResetDuration(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)

  let total = 0
  let found = false
  for (const part of trimmed.matchAll(/([\d.]+)\s*(ms|s|m|h)/gi)) {
    const amount = Number(part[1])
    if (!Number.isFinite(amount) || amount < 0) continue
    found = true
    const unit = (part[2] ?? "s").toLowerCase()
    const factor = unit === "ms" ? 1 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 1000
    total += amount * factor
  }
  return found ? Math.round(total) : null
}

/**
 * Some providers put the wait in the message instead of a Retry-After header.
 * Groq, for example, says "Please try again in 9.1725s". Reading it keeps a
 * one-minute quota from becoming a fifteen-minute outage.
 */
export function parseRetryHint(message: string | null): number | null {
  if (!message) return null

  const match = /(?:try again|retry|available) in\s+([\d.]+\s*(?:ms|s|m|h)?(?:\s*[\d.]+\s*(?:ms|s|m|h))?)/i.exec(
    message,
  )
  if (match === null) return null

  let total = 0
  let found = false
  for (const part of match[1].matchAll(/([\d.]+)\s*(ms|s|m|h)?/gi)) {
    const amount = Number(part[1])
    if (!Number.isFinite(amount) || amount < 0) continue
    found = true
    const unit = (part[2] ?? "s").toLowerCase()
    const factor = unit === "ms" ? 1 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 1000
    total += amount * factor
  }

  return found ? Math.round(total) : null
}

function extractErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const record = body as Record<string, unknown>

  const error = record.error
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message
    if (typeof message === "string") return message
  }

  if (typeof record.message === "string") return record.message

  const errors = record.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as Record<string, unknown> | undefined
    if (first && typeof first.message === "string") return first.message
  }

  return null
}

export interface JsonPostOptions {
  headers?: Record<string, string>
  signal: AbortSignal
  fetchImpl?: FetchLike
}

export async function postJson(
  url: string,
  body: unknown,
  options: JsonPostOptions,
): Promise<unknown> {
  const { headers = {}, signal, fetchImpl = fetch } = options

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  })

  const raw = await response.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }

  if (response.ok) {
    if (parsed === null) {
      throw new ProviderRequestError(`Invalid JSON response from ${url}`, response.status)
    }
    return parsed
  }

  const message = extractErrorMessage(parsed) ?? (raw.slice(0, 300) || `HTTP ${response.status}`)

  if (response.status === 401 || response.status === 403) {
    throw new ProviderAuthError(message)
  }
  if (response.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
    const retryWait =
      parseRetryAfter(response.headers.get("retry-after")) ??
      parseResetDuration(response.headers.get("x-ratelimit-reset-tokens")) ??
      parseResetDuration(response.headers.get("x-ratelimit-reset-requests")) ??
      parseRetryHint(message)
    throw new ProviderQuotaError(message, retryWait)
  }
  throw new ProviderRequestError(message, response.status)
}
