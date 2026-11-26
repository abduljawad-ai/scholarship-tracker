// Pure eligibility heuristics — no DOM, no clock, no data loading.
import type { StudyLevel } from "./constants"
import type { Cycle, Program } from "./schema"

const NEXT_LEVEL: Record<StudyLevel, StudyLevel[]> = {
  matric: ["intermediate"],
  intermediate: ["bachelor"],
  bachelor: ["master"],
  master: ["phd"],
  phd: ["phd"],
}

/** The study stages a student at `current` should look at next. */
export function stagesForCurrentLevel(current: StudyLevel): StudyLevel[] {
  return NEXT_LEVEL[current]
}

export interface EligibilityInput {
  currentLevel: StudyLevel
  nationality: "PK"
  age?: number
}

export interface EligibilityResult {
  likelyEligible: boolean
  reasons: string[]
}

/**
 * Conservative eligibility check against a program's declared rules.
 * Returns every applicable reason; `likelyEligible` is true only when no
 * rule fails. Pure and status-driven — no wall clock.
 */
export function evaluateEligibility(
  program: Program,
  cycle: Cycle,
  input: EligibilityInput,
): EligibilityResult {
  const reasons: string[] = []
  let eligible = true

  const stages = program.applicantStages
  const levelMatches =
    stages.includes(input.currentLevel) ||
    stagesForCurrentLevel(input.currentLevel).some((stage) => stages.includes(stage))
  if (!levelMatches) {
    eligible = false
    reasons.push("Your study level does not match this program")
  }

  const nationalities = program.eligibility.nationalities
  const nationalityOk =
    nationalities.length === 0 ||
    nationalities.includes("PK") ||
    nationalities.includes("any")
  if (!nationalityOk) {
    eligible = false
    reasons.push("Not open to your nationality")
  }

  const ageMax = program.eligibility.ageMax
  if (input.age === undefined) {
    reasons.push("Age limit not checked")
  } else if (ageMax !== null && input.age > ageMax) {
    eligible = false
    reasons.push("Over the age limit")
  }

  if (cycle.status !== "open" && cycle.status !== "upcoming") {
    eligible = false
    reasons.push("Applications are closed for this cycle")
  }

  return { likelyEligible: eligible, reasons }
}
