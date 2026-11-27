// Cycle status derived from date-only fields. Pure and shared by the build,
// the tests, and the daily pipeline. The pipeline writes the derived status
// into the published JSON; this module is the single rule for what "open",
// "upcoming", and "closed" mean.

export type DerivedCycleStatus = 'open' | 'upcoming' | 'closed'

const PAKISTAN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date in Pakistan as YYYY-MM-DD. */
export function todayInPakistan(now: Date): string {
  const parts = PAKISTAN_DATE.formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${value('year')}-${value('month')}-${value('day')}`
}

/**
 * Derive a cycle status from its dates. Returns null when neither date is
 * known, so callers can keep an explicit existing status.
 */
export function deriveCycleStatus(
  dates: { opens: string | null; deadline: string | null },
  today: string,
): DerivedCycleStatus | null {
  if (dates.deadline !== null && dates.deadline < today) return 'closed'
  if (dates.opens !== null && dates.opens > today) return 'upcoming'
  if (dates.opens !== null) return 'open'
  if (dates.deadline !== null) return 'open'
  return null
}
