import type { FundingType } from "./constants"
import { STUDY_LEVELS, type StudyLevel } from "./constants"
import type { Program } from "./schema"
import { isActive, nextCycle } from "./selectors"
import { evaluateEligibility } from "./eligibility"

export interface ProgramIndexEntry {
  programId: string
  slug: string
  title: string
  provider: string
  country: string
  fundedLevels: StudyLevel[]
  applicantStages: StudyLevel[]
  nextDeadline: string | null
  deadlineVerified: boolean
  fundingType: FundingType
  fundingScore: number
  status: "active" | "archived"
  firstSeen: string
  likelyEligibleFor: StudyLevel[]
}

export interface FilterState {
  query: string
  level: StudyLevel | "all"
  country?: string | "all"
  currentLevel: StudyLevel
  eligibleOnly: boolean
  funding: "all" | "fully" | "stipend" | "tuition" | "partial"
  deadlineWindow: "all" | "30" | "90"
  status: "active" | "archived" | "all"
}

const FUNDING_FILTER: Record<Exclude<FilterState["funding"], "all">, FundingType> = {
  fully: "fully-funded",
  stipend: "stipend",
  tuition: "tuition",
  partial: "partial",
}

const FUNDING_SCORE: Record<FundingType, number> = {
  "fully-funded": 3,
  stipend: 2,
  tuition: 1,
  partial: 0.5,
}

export function toIndexEntry(program: Program): ProgramIndexEntry {
  const cycle = nextCycle(program)

  let nextDeadline: string | null = null
  let deadlineVerified = false
  if (cycle) {
    const d = cycle.dates.deadline
    if (d !== null) {
      nextDeadline = d
      if (cycle.verification.deadline === "verified") {
        deadlineVerified = true
      }
    }
  }

  const fundingType = program.funding.type
  const status: "active" | "archived" = isActive(program) ? "active" : "archived"

  let likelyEligibleFor: StudyLevel[] = []
  if (cycle) {
    const levels: StudyLevel[] = []
    for (const level of STUDY_LEVELS) {
      const result = evaluateEligibility(program, cycle, {
        currentLevel: level,
        nationality: "PK",
      })
      if (result.likelyEligible) levels.push(level)
    }
    likelyEligibleFor = levels
  }

  return {
    programId: program.programId,
    slug: program.programId,
    title: program.title,
    provider: program.provider,
    country: program.country,
    fundedLevels: program.fundedLevels,
    applicantStages: program.applicantStages,
    nextDeadline,
    deadlineVerified,
    fundingType,
    fundingScore: FUNDING_SCORE[fundingType],
    status,
    firstSeen: program.firstSeen,
    likelyEligibleFor,
  }
}

export function matchesQuery(entry: ProgramIndexEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === "") return true
  const haystack = [
    entry.title,
    entry.provider,
    entry.country,
    ...entry.fundedLevels,
  ].map((s) => s.toLowerCase())
  return haystack.some((s) => s.includes(q))
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function filterIndex(
  entries: ProgramIndexEntry[],
  filters: FilterState,
  now: Date,
): ProgramIndexEntry[] {
  const today = now.toISOString().slice(0, 10)
  const result: ProgramIndexEntry[] = []

  for (const entry of entries) {
    if (!matchesQuery(entry, filters.query)) continue
    if (filters.level !== "all" && !entry.fundedLevels.includes(filters.level)) continue
    if (filters.country && filters.country !== "all" && entry.country !== filters.country) continue
    if (filters.status !== "all" && entry.status !== filters.status) continue
    if (filters.eligibleOnly) {
      if (entry.status !== "active") continue
      if (!entry.likelyEligibleFor.includes(filters.currentLevel)) continue
    }
    if (filters.funding !== "all" && entry.fundingType !== FUNDING_FILTER[filters.funding]) continue
    if (filters.deadlineWindow !== "all") {
      const n = Number(filters.deadlineWindow)
      if (!(entry.deadlineVerified && entry.nextDeadline !== null)) continue
      const deadline = entry.nextDeadline
      if (deadline < today) continue
      const end = addDays(today, n)
      if (deadline > end) continue
    }
    result.push(entry)
  }

  return result
}

export function sortIndex(
  entries: ProgramIndexEntry[],
  sort: "newest" | "best-funded" | "deadline",
): ProgramIndexEntry[] {
  const copy = [...entries]
  if (sort === "newest") {
    copy.sort((a, b) => {
      if (a.firstSeen === b.firstSeen) return 0
      return a.firstSeen < b.firstSeen ? 1 : -1
    })
  } else if (sort === "best-funded") {
    copy.sort((a, b) => {
      if (a.fundingScore === b.fundingScore) return 0
      return a.fundingScore < b.fundingScore ? 1 : -1
    })
  } else {
    copy.sort((a, b) => {
      if (a.nextDeadline === null && b.nextDeadline === null) return 0
      if (a.nextDeadline === null) return 1
      if (b.nextDeadline === null) return -1
      if (a.nextDeadline === b.nextDeadline) return 0
      return a.nextDeadline < b.nextDeadline ? -1 : 1
    })
  }
  return copy
}
