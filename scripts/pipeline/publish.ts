// Merge extracted facts into published program data and write it atomically.
// The merge is deliberately conservative: verified values win, provisional
// values never overwrite verified ones, and identity fields never change.
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { deriveCycleStatus } from "../../src/lib/cycle-status"
import { parseProgram, type Cycle, type Program } from "../../src/lib/schema"
import type { ExtractedCycle, Extraction, SourceConfig } from "./types"

export interface MergeOptions {
  today: string
  now: Date
  verifiedFields: Set<string>
  guideVerified: boolean
}

const DATE_ONLY_FIELDS = ["opens", "resultsDate", "studyStart"] as const

/** A stable cycle id: the first year in the label, else the fallback date year. */
export function cycleIdFromLabel(label: string | null, fallbackDate: string | null): string {
  const year = label === null ? null : /(?:19|20)\d{2}/.exec(label)?.[0]
  if (year) return year

  const fallbackYear = fallbackDate?.match(/^(\d{4})-/)?.[1]
  if (fallbackYear) return fallbackYear

  const slug = (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "current"
}

function sourceUrlsFor(extraction: Extraction, source: SourceConfig): string[] {
  const urls = new Set<string>()
  for (const cycle of extraction.cycles) {
    for (const evidence of cycle.evidence) {
      urls.add(evidence.sourceUrl)
    }
  }
  if (urls.size === 0) {
    for (const url of source.pageUrls) urls.add(url)
  }
  return [...urls]
}

function refreshSources(
  existing: Cycle["sources"],
  extraction: Extraction,
  source: SourceConfig,
  today: string,
): Cycle["sources"] {
  const next = existing.map((entry) => ({ ...entry }))

  for (const url of sourceUrlsFor(extraction, source)) {
    const match = next.find((entry) => entry.url === url)
    if (match) {
      match.lastVerified = today
    } else {
      next.push({ url, type: "official-page", lastVerified: today })
    }
  }

  return next
}

function mergeEvidence(
  existing: Cycle["evidence"],
  extracted: ExtractedCycle,
): Cycle["evidence"] {
  const next = existing.map((entry) => ({ ...entry }))

  for (const item of extracted.evidence) {
    const index = next.findIndex((entry) => entry.field === item.field)
    if (index >= 0) {
      next[index] = { ...item }
    } else {
      next.push({ ...item })
    }
  }

  return next
}

function confidenceFor(dates: Cycle["dates"], applyUrl: string | null, verification: Cycle["verification"]): number {
  const present = [dates.deadline !== null, applyUrl !== null].filter(Boolean).length
  if (present === 0) return 0

  const verified = [
    dates.deadline !== null && verification.deadline === "verified",
    applyUrl !== null && verification.applyUrl === "verified",
  ].filter(Boolean).length

  return verified / present
}

function statusFor(
  dates: Cycle["dates"],
  today: string,
  fallback: Cycle["status"],
): Cycle["status"] {
  if (fallback === "archived") return "archived"
  return deriveCycleStatus({ opens: dates.opens, deadline: dates.deadline }, today) ?? fallback
}

function mergeExistingCycle(
  existing: Cycle,
  extracted: ExtractedCycle,
  source: SourceConfig,
  extraction: Extraction,
  options: MergeOptions,
): Cycle {
  const verified = (field: string) => options.verifiedFields.has(field)

  const dates = { ...existing.dates }
  for (const field of DATE_ONLY_FIELDS) {
    const value = extracted.dates[field]
    if (verified(field) && value !== null) {
      dates[field] = value
    }
  }

  let deadlineVerification = existing.verification.deadline
  if (extracted.dates.deadline !== null) {
    if (verified("deadline")) {
      dates.deadline = extracted.dates.deadline
      deadlineVerification = "verified"
    } else if (existing.verification.deadline !== "verified") {
      dates.deadline = extracted.dates.deadline
      deadlineVerification = "provisional"
    }
  }

  const apply = { ...existing.apply }
  let applyVerification = existing.verification.applyUrl
  if (verified("applyUrl") && extracted.apply.url !== null) {
    apply.url = extracted.apply.url
    if (extracted.apply.portalName !== null) apply.portalName = extracted.apply.portalName
    if (extracted.apply.fee !== null) apply.fee = extracted.apply.fee
    applyVerification = "verified"
  }

  const verification: Cycle["verification"] = {
    ...existing.verification,
    deadline: deadlineVerification,
    applyUrl: applyVerification,
  }

  return {
    ...existing,
    dates,
    status: statusFor(dates, options.today, extracted.status ?? existing.status),
    apply,
    verification,
    sources: refreshSources(existing.sources, extraction, source, options.today),
    evidence: mergeEvidence(existing.evidence, extracted),
    confidence: confidenceFor(dates, apply.url, verification),
  }
}

function createCycle(
  cycleId: string,
  extracted: ExtractedCycle,
  source: SourceConfig,
  extraction: Extraction,
  options: MergeOptions,
): Cycle {
  const verified = (field: string) => options.verifiedFields.has(field)

  const dates: Cycle["dates"] = {
    opens: verified("opens") ? extracted.dates.opens : null,
    deadline: extracted.dates.deadline,
    resultsDate: verified("resultsDate") ? extracted.dates.resultsDate : null,
    studyStart: verified("studyStart") ? extracted.dates.studyStart : null,
  }

  const applyUrl = verified("applyUrl") ? extracted.apply.url : null
  const verification: Cycle["verification"] = {
    deadline:
      extracted.dates.deadline === null
        ? "unverified"
        : verified("deadline")
          ? "verified"
          : "provisional",
    applyUrl: applyUrl === null ? "unverified" : "verified",
    funding: "unverified",
    eligibility: "unverified",
  }

  return {
    cycleId,
    label:
      extracted.label ??
      (cycleId === "current" ? "Current cycle" : `${cycleId} application cycle`),
    dates,
    status: statusFor(dates, options.today, extracted.status ?? "upcoming"),
    apply: {
      url: applyUrl,
      portalName: applyUrl === null ? null : extracted.apply.portalName,
      fee: applyUrl === null ? null : extracted.apply.fee,
    },
    verification,
    sources: refreshSources([], extraction, source, options.today),
    evidence: mergeEvidence([], extracted),
    confidence: confidenceFor(dates, applyUrl, verification),
  }
}

/**
 * Merge one extraction into one program. Existing cycles keep their identity,
 * order, and `firstSeen`; new cycles are appended.
 */
export function mergeExtraction(
  program: Program,
  extraction: Extraction,
  source: SourceConfig,
  options: MergeOptions,
): Program {
  const cycles = program.cycles.map((cycle) => ({ ...cycle }))
  const extractionByCycleId = new Map<string, ExtractedCycle>()

  for (const extracted of extraction.cycles) {
    const cycleId = cycleIdFromLabel(
      extracted.label,
      extracted.dates.deadline ?? extracted.dates.opens,
    )
    extractionByCycleId.set(cycleId, extracted)

    const index = cycles.findIndex((cycle) => cycle.cycleId === cycleId)
    if (index >= 0) {
      cycles[index] = mergeExistingCycle(
        cycles[index]!,
        extracted,
        source,
        extraction,
        options,
      )
    } else {
      cycles.push(createCycle(cycleId, extracted, source, extraction, options))
    }
  }

  return {
    ...program,
    guide:
      options.guideVerified && extraction.guide !== null
        ? {
            steps: [...extraction.guide.steps],
            documents: [...extraction.guide.documents],
            tips: [...extraction.guide.tips],
            timeline: [...extraction.guide.timeline],
          }
        : program.guide,
    cycles,
    lastUpdated: options.now.toISOString(),
  }
}

/** Validate, then write via temp file + rename so readers never see a partial file. */
export function writeProgramFile(program: Program, dataDir: string): void {
  const parsed = parseProgram(program)
  mkdirSync(dataDir, { recursive: true })

  const filePath = path.join(dataDir, `${parsed.programId}.json`)
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  renameSync(tempPath, filePath)
}

/** Flip the public site from demo data to live data after a clean run. */
export function setRunStatusLive(runStatusPath: string, now: Date): void {
  const tempPath = `${runStatusPath}.tmp`
  writeFileSync(
    tempPath,
    `${JSON.stringify({ mode: "live", lastSuccessfulRun: now.toISOString() }, null, 2)}\n`,
    "utf8",
  )
  renameSync(tempPath, runStatusPath)
}
