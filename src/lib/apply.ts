import type { Cycle } from "./schema"

/**
 * Apply is shown only for a live cycle whose apply URL was verified. A closed
 * cycle, a provisional apply link, or a missing URL never gets the button.
 */
export function canApply(cycle: Cycle): boolean {
  return (
    (cycle.status === "open" || cycle.status === "upcoming") &&
    cycle.verification.applyUrl === "verified" &&
    cycle.apply.url !== null
  )
}
