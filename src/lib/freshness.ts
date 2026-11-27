// Freshness of the published data. Browser-safe: the banner script and the
// build both import this module, so it must not touch node:* APIs.
//
// `run-status.json` is written by the daily automation (Plan 2). Until that is
// connected the site ships with mode "sample", which must never claim that the
// data is live.

export type FreshnessMode = 'sample' | 'live'
export type FreshnessState = 'sample' | 'stale' | 'fresh'

export interface RunStatus {
  mode: FreshnessMode
  lastSuccessfulRun: string | null
}

/** A successful run older than this is treated as stale. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

export function freshnessState(status: RunStatus, now: Date): FreshnessState {
  if (status.mode === 'sample') return 'sample'
  if (status.lastSuccessfulRun === null) return 'stale'

  const last = Date.parse(status.lastSuccessfulRun)
  if (Number.isNaN(last)) return 'stale'

  return now.getTime() - last > STALE_AFTER_MS ? 'stale' : 'fresh'
}

/** Human relative time for the stale banner. Future dates read as "just now". */
export function relativeTime(iso: string, now: Date): string {
  const last = Date.parse(iso)
  if (Number.isNaN(last)) return 'recently'

  const seconds = Math.max(0, Math.floor((now.getTime() - last) / 1000))
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function freshnessMessage(
  state: FreshnessState,
  status: RunStatus,
  now: Date,
): string {
  if (state === 'sample') {
    return 'Demo data — automated updates are not connected yet.'
  }
  if (state === 'fresh') return ''

  if (status.lastSuccessfulRun === null) {
    return 'Data has not been updated yet — refresh may be delayed.'
  }
  const last = Date.parse(status.lastSuccessfulRun)
  if (Number.isNaN(last)) {
    return 'Data has not been updated yet — refresh may be delayed.'
  }
  return `Data last updated ${relativeTime(status.lastSuccessfulRun, now)} — refresh may be delayed.`
}
