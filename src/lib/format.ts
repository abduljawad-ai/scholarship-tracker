import type { FundingType, VerificationStatus } from "./constants"

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  return DATE_FORMATTER.format(d)
}

export function formatDeadline(
  deadline: string | null,
  status: VerificationStatus,
): string {
  if (deadline === null) return "No deadline listed"
  if (status === "verified") return formatDate(deadline)
  return "Deadline not confirmed — check official page"
}

export function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso + "T00:00:00Z").getTime()
  const nowMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - nowMidnight) / 86_400_000)
}

const FUNDING_LABELS: Record<FundingType, string> = {
  "fully-funded": "Fully funded",
  stipend: "Stipend",
  tuition: "Tuition covered",
  partial: "Partial funding",
}

export function fundingLabel(type: FundingType): string {
  return FUNDING_LABELS[type]
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString("en-GB")}`
  }
}