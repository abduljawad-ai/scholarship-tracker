// Polite HTTP for the daily pipeline: timeouts, bounded retries, robots.txt,
// and content hashing. No dependency on the site build.
import { createHash } from "node:crypto"
import { USER_AGENT } from "./config"
import { htmlToText } from "./html"
import { pdfToText } from "./pdf"
import type { PageSnapshot } from "./types"

export class FetchError extends Error {
  readonly status: number | null
  readonly url: string

  constructor(message: string, status: number | null, url: string) {
    super(message)
    this.name = "FetchError"
    this.status = status
    this.url = url
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface FetchOptions {
  fetchImpl?: FetchLike
  timeoutMs?: number
  maxAttempts?: number
  userAgent?: string
  /** Injected by tests so retries do not spend real time. */
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export type ByteSnapshot = Omit<PageSnapshot, "text"> & { bytes: Uint8Array }

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const ALLOWED_TEXT_TYPES = new Set([
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/pdf",
])

const ACCEPT =
  "text/html, application/xhtml+xml, application/pdf, text/plain;q=0.9, */*;q=0.1"

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function backoff(attempt: number, random: () => number): number {
  return Math.min(8_000, 500 * 2 ** attempt) + random() * 250
}

function normalizeContentType(value: string | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase()
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex")
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

async function request(url: string, options: FetchOptions): Promise<Response> {
  const {
    fetchImpl = fetch,
    timeoutMs = 60_000,
    maxAttempts = 3,
    userAgent = USER_AGENT,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  let lastError: FetchError | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": userAgent, accept: ACCEPT },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const aborted =
        err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
      const message = err instanceof Error ? err.message : String(err)
      lastError = new FetchError(
        aborted ? `Request timed out after ${timeoutMs}ms: ${url}` : `Network error for ${url}: ${message}`,
        null,
        url,
      )

      if (aborted || attempt === maxAttempts - 1) throw lastError
      await sleep(backoff(attempt, random))
      continue
    }

    if (response.ok) return response

    lastError = new FetchError(`HTTP ${response.status} for ${url}`, response.status, url)
    if (!RETRY_STATUSES.has(response.status) || attempt === maxAttempts - 1) {
      throw lastError
    }

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
    await sleep(retryAfter ?? backoff(attempt, random))
  }

  throw lastError ?? new FetchError(`Failed to fetch ${url}`, null, url)
}

/** Fetch a page and return its visible text plus a content hash. */
export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<PageSnapshot> {
  const response = await request(url, options)
  const contentType = normalizeContentType(response.headers.get("content-type"))
  const finalUrl = response.url || url

  if (!ALLOWED_TEXT_TYPES.has(contentType)) {
    throw new FetchError(
      `Unsupported content type "${contentType || "unknown"}" for ${url}`,
      response.status,
      url,
    )
  }

  if (contentType === "application/pdf") {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = await pdfToText(bytes)
    return { url, finalUrl, status: response.status, contentType, hash: hashText(text), text }
  }

  const raw = await response.text()
  const text =
    contentType === "text/html" || contentType === "application/xhtml+xml"
      ? htmlToText(raw)
      : raw.trim()

  return { url, finalUrl, status: response.status, contentType, hash: hashText(text), text }
}

/** Fetch raw bytes (used when a caller wants the file itself). */
export async function fetchBytes(
  url: string,
  options: FetchOptions = {},
): Promise<ByteSnapshot> {
  const response = await request(url, options)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    url,
    finalUrl: response.url || url,
    status: response.status,
    contentType: normalizeContentType(response.headers.get("content-type")),
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  }
}

// robots.txt is fetched once per origin per process.
const robotsCache = new Map<string, string>()

export function clearRobotsCache(): void {
  robotsCache.clear()
}

interface RobotsGroup {
  agents: string[]
  allow: string[]
  disallow: string[]
}

function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim()
    if (!line) continue

    const separator = line.indexOf(":")
    if (separator === -1) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }

    lastWasAgent = false
    if (!current) continue
    if (field === "allow") current.allow.push(value)
    else if (field === "disallow") current.disallow.push(value)
  }

  return groups
}

function patternMatches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$")
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path)
}

function allowedByRobots(path: string, robotsText: string, token: string): boolean {
  const groups = parseRobots(robotsText)
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && token.includes(agent)),
  )
  const chosen =
    specific.length > 0
      ? specific
      : groups.filter((group) => group.agents.includes("*"))

  let best: { allow: boolean; length: number } | null = null
  for (const group of chosen) {
    for (const pattern of group.allow) {
      if (pattern === "" || !patternMatches(path, pattern)) continue
      if (!best || pattern.length > best.length || (pattern.length === best.length && !best.allow)) {
        best = { allow: true, length: pattern.length }
      }
    }
    for (const pattern of group.disallow) {
      if (pattern === "" || !patternMatches(path, pattern)) continue
      if (!best || pattern.length > best.length) {
        best = { allow: false, length: pattern.length }
      }
    }
  }

  return best ? best.allow : true
}

async function fetchRobots(origin: string, options: FetchOptions): Promise<string> {
  const { fetchImpl = fetch, timeoutMs = 15_000, userAgent = USER_AGENT } = options
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { "user-agent": userAgent, accept: "text/plain" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok ? await response.text() : ""
  } catch {
    // An unreachable robots.txt is treated as no restriction, the common
    // crawler convention. The site itself is still rate-limited and polite.
    return ""
  }
}

export async function robotsAllows(
  url: string,
  options: FetchOptions = {},
): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  let robots = robotsCache.get(parsed.origin)
  if (robots === undefined) {
    robots = await fetchRobots(parsed.origin, options)
    robotsCache.set(parsed.origin, robots)
  }

  const token = (options.userAgent ?? USER_AGENT).split("/")[0]!.trim().toLowerCase()
  return allowedByRobots(parsed.pathname || "/", robots, token)
}
