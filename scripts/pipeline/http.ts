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
    throw new ProviderQuotaError(message, parseRetryAfter(response.headers.get("retry-after")))
  }
  throw new ProviderRequestError(message, response.status)
}
