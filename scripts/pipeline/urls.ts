// Apply-link checks. A link is only publishable when it is HTTPS, on an
// official host, and actually answers. A redirect to an unofficial host is a
// phishing signal, not a convenience.
import type { FetchLike } from "./http"

const TIMEOUT_MS = 15_000
const REDIRECT_STATUSES = new Set([405, 501])

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

/** True for an exact host or a subdomain of an allowed host. */
export function isAllowedHost(url: string, hosts: string[]): boolean {
  const host = hostOf(url)
  if (!host) return false

  return hosts.some((allowed) => {
    const clean = allowed.toLowerCase().replace(/^www\./, "")
    return host === clean || host.endsWith(`.${clean}`)
  })
}

/** Apply links must be HTTPS and on an official host. */
export function isAllowedApplyUrl(url: string, hosts: string[]): boolean {
  return isHttps(url) && isAllowedHost(url, hosts)
}

export interface ApplyUrlCheck {
  ok: boolean
  finalUrl: string | null
  reason: string
}

async function request(
  url: string,
  method: "HEAD" | "GET",
  fetchImpl: FetchLike,
): Promise<Response> {
  return fetchImpl(url, {
    method,
    redirect: "follow",
    headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/**
 * Fetch the apply URL and accept a 2xx/3xx response whose final host is still
 * official. HEAD is tried first; servers that refuse it get a ranged GET.
 */
export async function checkApplyUrl(
  url: string,
  hosts: string[],
  fetchImpl: FetchLike = fetch,
): Promise<ApplyUrlCheck> {
  if (!isHttps(url)) {
    return { ok: false, finalUrl: null, reason: "Apply URL must use HTTPS" }
  }
  if (hosts.length > 0 && !isAllowedHost(url, hosts)) {
    return { ok: false, finalUrl: null, reason: "Apply URL is not on an official host" }
  }

  let response: Response
  try {
    response = await request(url, "HEAD", fetchImpl)
    if (REDIRECT_STATUSES.has(response.status)) {
      response = await request(url, "GET", fetchImpl)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, finalUrl: null, reason: `Apply URL could not be reached: ${message}` }
  }

  const finalUrl = response.url || url
  if (hosts.length > 0 && !isAllowedHost(finalUrl, hosts)) {
    return {
      ok: false,
      finalUrl,
      reason: `Apply URL redirects to ${hostOf(finalUrl) ?? finalUrl}, which is not an official host`,
    }
  }
  if (response.status < 200 || response.status >= 400) {
    return {
      ok: false,
      finalUrl,
      reason: `Apply URL returned HTTP ${response.status}`,
    }
  }

  return { ok: true, finalUrl, reason: `Apply URL answered HTTP ${response.status}` }
}
