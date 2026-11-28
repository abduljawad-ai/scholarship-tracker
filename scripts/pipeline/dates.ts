// Deterministic date checks. These run before any model call: if the quoted
// sentence does not literally contain the date we extracted, the fact is not
// publishable no matter what a second model says.
import { normalizeText } from "./text"

const MONTHS: Array<{ number: number; names: string[] }> = [
  { number: 1, names: ["january", "jan"] },
  { number: 2, names: ["february", "feb"] },
  { number: 3, names: ["march", "mar"] },
  { number: 4, names: ["april", "apr"] },
  { number: 5, names: ["may"] },
  { number: 6, names: ["june", "jun"] },
  { number: 7, names: ["july", "jul"] },
  { number: 8, names: ["august", "aug"] },
  { number: 9, names: ["september", "sept", "sep"] },
  { number: 10, names: ["october", "oct"] },
  { number: 11, names: ["november", "nov"] },
  { number: 12, names: ["december", "dec"] },
]

function parseIso(isoDate: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

function dayPattern(day: number): string {
  return `0?${day}(?:st|nd|rd|th)?`
}

/**
 * True when the quote states the ISO date in a written or unambiguous numeric
 * form. Numeric `D/M/YYYY` is only accepted when the day is greater than 12,
 * because `03/11/2027` could mean March 11 or November 3.
 */
export function quoteSupportsDate(quote: string, isoDate: string): boolean {
  const target = parseIso(isoDate)
  if (!target) return false

  const text = normalizeText(quote)
  if (!text) return false

  const { year, month, day } = target
  const monthEntry = MONTHS[month - 1]!
  const monthNames = monthEntry.names.join("|")
  const dayPart = dayPattern(day)
  const yearPart = String(year)
  const paddedDay = String(day).padStart(2, "0")
  const paddedMonth = String(month).padStart(2, "0")

  const patterns = [
    // 3 November 2027, 3rd of November 2027
    `\\b${dayPart}\\s+(?:of\\s+)?(?:${monthNames})\\s+${yearPart}\\b`,
    // November 3, 2027 / November 3rd 2027
    `\\b(?:${monthNames})\\s+${dayPart}\\s+${yearPart}\\b`,
    // 2027-11-03
    `\\b${yearPart}-${paddedMonth}-${paddedDay}\\b`,
  ]

  // A numeric date with day > 12 is unambiguous, whichever separator is used.
  if (day > 12) {
    patterns.push(`\\b${paddedDay}[/-]${paddedMonth}[/-]${yearPart}\\b`)
    patterns.push(`\\b${day}[/-]${month}[/-]${yearPart}\\b`)
  }

  if (patterns.some((pattern) => new RegExp(pattern).test(text))) return true

  // A range such as "10 January - 20 February 2026" gives the year once, at
  // the end. Accept the day and month when the quote contains exactly one year
  // and that year is the target year. Two different years are ambiguous.
  const years = new Set(text.match(/\b(?:19|20)\d{2}\b/g) ?? [])
  if (years.size === 1 && years.has(yearPart)) {
    const dayMonth = new RegExp(`\\b${dayPart}\\s+(?:of\\s+)?(?:${monthNames})\\b`)
    const monthDay = new RegExp(`\\b(?:${monthNames})\\s+${dayPart}\\b`)
    if (dayMonth.test(text) || monthDay.test(text)) return true
  }

  return false
}

/**
 * A deadline is plausible from two years back through three years ahead. The
 * past window keeps real closed cycles in the archive; anything older or
 * further out is a data error, not a real application window.
 */
export function isPlausibleDeadline(isoDate: string, today: string): boolean {
  return isPlausibleDate(isoDate, today, { pastYears: 2, futureYears: 3 })
}

/** Generic date window used for opens/results/study dates. */
export function isPlausibleDate(
  isoDate: string,
  today: string,
  window: { pastYears: number; futureYears: number },
): boolean {
  const target = parseIso(isoDate)
  const start = parseIso(today)
  if (!target || !start) return false

  const targetTime = Date.UTC(target.year, target.month - 1, target.day)
  const startTime = Date.UTC(start.year, start.month - 1, start.day)
  const lower = new Date(startTime)
  lower.setUTCFullYear(lower.getUTCFullYear() - window.pastYears)
  const upper = new Date(startTime)
  upper.setUTCFullYear(upper.getUTCFullYear() + window.futureYears)

  return targetTime >= lower.getTime() && targetTime <= upper.getTime()
}
