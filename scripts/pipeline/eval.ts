// Golden-fixture eval: replays recorded model output through the real
// extraction, validation, and merge code so a prompt or rule change that
// breaks trust fails here instead of in production.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { parseProgram } from "../../src/lib/schema"
import { loadConfig } from "./config"
import { parseCandidates, parseDiscoveryResponse } from "./discover"
import { parseExtraction, validateExtraction } from "./extract"
import { htmlToText } from "./html"
import { mergeExtraction } from "./publish"
import { loadSources } from "./sources"
import type { PageSnapshot, SourceConfig } from "./types"

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

const ExpectSchema = z
  .object({
    invalid: z.boolean().optional(),
    cycles: z.number().int().min(0).optional(),
    cycleId: z.string().min(1).optional(),
    status: z.enum(["open", "upcoming", "closed", "archived"]).optional(),
    deadline: IsoDate.nullable().optional(),
    deadlineVerification: z.enum(["verified", "provisional", "unverified"]).optional(),
    applyUrl: z.string().nullable().optional(),
    pages: z.number().int().min(0).optional(),
    scholarships: z.number().int().min(0).optional(),
    candidates: z.number().int().min(0).optional(),
  })
  .strict()

const CaseSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["extract", "discover"]),
    html: z.string().min(1),
    output: z.string().min(1),
    candidates: z.string().min(1).optional(),
    sourceId: z.string().min(1),
    /** Page the fixture was recorded from; defaults to the source's first pageUrl. */
    url: z.string().min(1).optional(),
    programId: z.string().min(1).optional(),
    today: IsoDate.optional(),
    verifiedFields: z.array(z.string()).optional(),
    expect: ExpectSchema,
  })
  .strict()

const CasesFileSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(CaseSchema),
  })
  .strict()

type EvalCase = z.infer<typeof CaseSchema>

export interface EvalResult {
  passed: number
  failed: string[]
}

function snapshotFor(html: string, url: string): PageSnapshot {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    hash: "",
    text: htmlToText(html),
    html,
  }
}

function sourceFor(sources: SourceConfig[], sourceId: string): SourceConfig {
  const source = sources.find((entry) => entry.sourceId === sourceId)
  if (!source) throw new Error(`Unknown sourceId "${sourceId}" in cases.json`)
  return source
}

function checkExtract(entry: EvalCase, root: string, sources: SourceConfig[]): string[] {
  const problems: string[] = []
  if (!entry.today || !entry.verifiedFields) {
    return ["extract case is missing today or verifiedFields"]
  }
  const source = sourceFor(sources, entry.sourceId)
  const url = entry.url ?? source.pageUrls[0]!
  const snapshot = snapshotFor(
    readFileSync(path.join(root, "pipeline/fixtures", entry.html), "utf8"),
    url,
  )

  const extraction = parseExtraction(
    readFileSync(path.join(root, "pipeline/fixtures", entry.output), "utf8"),
  )
  const errors = validateExtraction(extraction, snapshot, source)

  if (entry.expect.invalid) {
    if (errors.length === 0) problems.push("expected the extraction to be rejected, but it validated")
    return problems
  }
  if (errors.length > 0) {
    problems.push(`extraction did not validate: ${errors.join("; ")}`)
    return problems
  }

  if (!entry.programId) {
    problems.push("extract case is missing programId")
    return problems
  }

  const programPath = path.join(root, "src/data/programs", `${entry.programId}.json`)
  if (!existsSync(programPath)) {
    problems.push(`missing program file ${entry.programId}.json`)
    return problems
  }

  const merged = mergeExtraction(
    parseProgram(JSON.parse(readFileSync(programPath, "utf8"))),
    extraction,
    source,
    {
      today: entry.today,
      now: new Date(`${entry.today}T00:00:00.000Z`),
      verifiedFields: new Set(entry.verifiedFields),
      guideVerified: false,
    },
  )

  const expect = entry.expect
  if (expect.cycles !== undefined && merged.cycles.length !== expect.cycles) {
    problems.push(`expected ${expect.cycles} cycles, got ${merged.cycles.length}`)
  }

  const cycle =
    expect.cycleId === undefined
      ? merged.cycles[0]
      : merged.cycles.find((item) => item.cycleId === expect.cycleId)
  if (expect.cycleId !== undefined && !cycle) {
    problems.push(`expected a cycle with cycleId "${expect.cycleId}"`)
    return problems
  }
  if (!cycle) return problems

  if (expect.status !== undefined && cycle.status !== expect.status) {
    problems.push(`expected status ${expect.status}, got ${cycle.status}`)
  }
  if (expect.deadline !== undefined && cycle.dates.deadline !== expect.deadline) {
    problems.push(`expected deadline ${expect.deadline ?? "null"}, got ${cycle.dates.deadline ?? "null"}`)
  }
  if (
    expect.deadlineVerification !== undefined &&
    cycle.verification.deadline !== expect.deadlineVerification
  ) {
    problems.push(
      `expected deadline verification ${expect.deadlineVerification}, got ${cycle.verification.deadline}`,
    )
  }
  if (expect.applyUrl !== undefined && cycle.apply.url !== expect.applyUrl) {
    problems.push(`expected apply URL ${expect.applyUrl ?? "null"}, got ${cycle.apply.url ?? "null"}`)
  }

  return problems
}

function checkDiscover(entry: EvalCase, root: string): string[] {
  const problems: string[] = []
  const dir = path.join(root, "pipeline/fixtures")
  const pages = parseDiscoveryResponse(readFileSync(path.join(dir, entry.output), "utf8"))
  const scholarships = pages.filter((page) => page.isScholarship).length

  if (entry.expect.pages !== undefined && pages.length !== entry.expect.pages) {
    problems.push(`expected ${entry.expect.pages} pages, got ${pages.length}`)
  }
  if (entry.expect.scholarships !== undefined && scholarships !== entry.expect.scholarships) {
    problems.push(`expected ${entry.expect.scholarships} scholarships, got ${scholarships}`)
  }

  if (entry.candidates) {
    const queued = parseCandidates(readFileSync(path.join(dir, entry.candidates), "utf8"))
    if (entry.expect.candidates !== undefined && queued.length !== entry.expect.candidates) {
      problems.push(`expected ${entry.expect.candidates} queued candidates, got ${queued.length}`)
    }
  }

  return problems
}

/** Replay every committed fixture. Returns the pass count and failing case ids. */
export function runEval(root: string = process.cwd()): EvalResult {
  const casesPath = path.join(root, "pipeline/fixtures/cases.json")
  const parsed = CasesFileSchema.safeParse(JSON.parse(readFileSync(casesPath, "utf8")))
  if (!parsed.success) {
    return { passed: 0, failed: [`cases.json: ${parsed.error.message}`] }
  }

  const config = loadConfig({}, root)
  const sources = loadSources(config.registryPath)

  let passed = 0
  const failed: string[] = []

  for (const entry of parsed.data.cases) {
    let problems: string[]
    try {
      problems = entry.kind === "extract" ? checkExtract(entry, root, sources) : checkDiscover(entry, root)
    } catch (err) {
      problems = [err instanceof Error ? err.message : String(err)]
    }

    if (problems.length === 0) {
      passed += 1
      console.log(`PASS ${entry.id}`)
    } else {
      failed.push(entry.id)
      console.log(`FAIL ${entry.id}`)
      for (const problem of problems) console.log(`     - ${problem}`)
    }
  }

  return { passed, failed }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const result = runEval()
  console.log(`\n${result.passed} passed, ${result.failed.length} failed`)
  if (result.failed.length > 0) process.exitCode = 1
}