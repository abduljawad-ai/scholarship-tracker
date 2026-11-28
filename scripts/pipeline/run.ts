// The daily orchestrator. It walks known official pages, skips unchanged
// content, verifies facts, merges them, and writes data atomically. Every item
// is isolated: one broken page never aborts the run. Provider exhaustion pauses
// the run and leaves the item pending so the next run resumes it.
import { existsSync } from "node:fs"
import { todayInPakistan } from "../../src/lib/cycle-status"
import { loadProgramsFrom } from "../../src/lib/data"
import type { Program } from "../../src/lib/schema"
import { isPlausibleDate, isPlausibleDeadline, quoteSupportsDate } from "./dates"
import { buildExtractRequest, parseExtraction, validateExtraction } from "./extract"
import { clearRobotsCache, fetchText, robotsAllows, type FetchLike } from "./fetch"
import { mergeExtraction, setRunStatusLive, writeProgramFile } from "./publish"
import { ProvidersExhaustedError } from "./router"
import { runDiscovery, type DiscoveryResult } from "./discover"
import { loadSources } from "./sources"
import {
  createFileStore,
  createMemoryStore,
  itemKey,
  startOrResumeRun,
  updateItem,
  type StateStore,
} from "./state"
import { quoteAppearsIn } from "./text"
import type {
  DiscoveryRunReport,
  Extraction,
  PageSnapshot,
  PipelineConfig,
  ProviderId,
  RunReport,
  RunStatus,
  RunSummary,
  Router,
  SourceConfig,
  SourceHealth,
} from "./types"
import { isAllowedApplyUrl } from "./urls"
import { verifyFact, type VerifiableFact } from "./verify"
import { writeReport } from "./report"

export interface RunOptions {
  config: PipelineConfig
  router: Router
  /** Shared with the router so checkpoints and provider usage never clobber. */
  store?: StateStore
  fetchImpl?: FetchLike
  now: Date
  dryRun: boolean
  maxItems: number
  sourceId?: string
  allowLive: boolean
  /** Maintenance runs can skip the discovery loop and only check known pages. */
  discovery?: boolean
  /** Injected by tests so fetch retries do not spend real time. */
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export interface RunResult {
  summary: RunSummary
  report: RunReport
}

const MIN_PAGE_LENGTH = 400
const SOURCE_RETIRE_AFTER = 5
const MAX_BACKOFF_MINUTES = 24 * 60

const DATE_WINDOWS: Record<
  "opens" | "resultsDate" | "studyStart",
  { pastYears: number; futureYears: number }
> = {
  opens: { pastYears: 2, futureYears: 3 },
  resultsDate: { pastYears: 0, futureYears: 4 },
  studyStart: { pastYears: 0, futureYears: 4 },
}

const GUIDE_FIELDS = ["steps", "documents", "tips", "timeline"] as const

function defaultSourceHealth(): SourceHealth {
  return { lastFetchedAt: null, failures: 0, retired: false, nextEligibleAt: null }
}

function markItemFailed(
  state: ReturnType<StateStore["get"]>,
  key: string,
  message: string,
  at: string,
  maxAttempts: number,
  deadLetter = true,
): ReturnType<StateStore["get"]> {
  const previous = state.run?.items[key]
  const attempts = (previous?.attempts ?? 0) + 1
  return updateItem(state, key, {
    state: deadLetter && attempts >= maxAttempts ? "dead" : "failed",
    attempts,
    lastError: message,
    updatedAt: at,
  })
}

function recordSourceFailure(
  state: ReturnType<StateStore["get"]>,
  sourceId: string,
  at: string,
): ReturnType<StateStore["get"]> {
  const previous = state.sources[sourceId] ?? defaultSourceHealth()
  const failures = previous.failures + 1
  const retired = failures >= SOURCE_RETIRE_AFTER
  const backoffMinutes = Math.min(MAX_BACKOFF_MINUTES, 15 * 2 ** failures)
  const nextEligibleAt = retired
    ? null
    : new Date(Date.parse(at) + backoffMinutes * 60_000).toISOString()

  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: { lastFetchedAt: at, failures, retired, nextEligibleAt },
    },
  }
}

function resetSourceHealth(
  state: ReturnType<StateStore["get"]>,
  sourceId: string,
  at: string,
): ReturnType<StateStore["get"]> {
  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: { lastFetchedAt: at, failures: 0, retired: false, nextEligibleAt: null },
    },
  }
}

function updatePage(
  state: ReturnType<StateStore["get"]>,
  key: string,
  snapshot: PageSnapshot,
  at: string,
): ReturnType<StateStore["get"]> {
  return {
    ...state,
    pages: {
      ...state.pages,
      [key]: {
        hash: snapshot.hash,
        textLength: snapshot.text.length,
        lastFetchedAt: at,
        failures: 0,
      },
    },
  }
}

function sourceIsHealthy(source: SourceConfig, state: ReturnType<StateStore["get"]>, now: Date): boolean {
  const health = state.sources[source.sourceId] ?? defaultSourceHealth()
  if (health.retired) return false
  if (health.nextEligibleAt === null) return true
  return Date.parse(health.nextEligibleAt) <= now.getTime()
}

interface VerifiedExtraction {
  extraction: Extraction
  verifiedFields: Set<string>
  guideVerified: boolean
}

/**
 * Deterministic checks first, then the second model. A deadline that cannot be
 * supported is removed from the extraction rather than stored as a guess.
 */
async function verifyExtraction(
  router: Router,
  source: SourceConfig,
  snapshot: PageSnapshot,
  extraction: Extraction,
  primaryProviderId: ProviderId,
  config: PipelineConfig,
  today: string,
  fetchImpl: FetchLike,
): Promise<VerifiedExtraction> {
  const sanitized = structuredClone(extraction)
  const verifiedFields = new Set<string>()

  const deadlinePresent = sanitized.cycles.some((cycle) => cycle.dates.deadline !== null)
  if (deadlinePresent) {
    let allVerified = true

    for (const cycle of sanitized.cycles) {
      const value = cycle.dates.deadline
      if (value === null) continue

      const evidence = cycle.evidence.find((item) => item.field === "deadline")
      const deterministic =
        evidence !== undefined &&
        quoteAppearsIn(evidence.quote, snapshot.text) &&
        quoteSupportsDate(evidence.quote, value) &&
        isPlausibleDeadline(value, today) &&
        (cycle.dates.opens === null || value >= cycle.dates.opens)

      if (!deterministic) {
        cycle.dates.deadline = null
        cycle.evidence = cycle.evidence.filter((item) => item.field !== "deadline")
        allVerified = false
        continue
      }

      const fact: VerifiableFact = {
        field: "deadline",
        value,
        quote: evidence.quote,
        sourceUrl: evidence.sourceUrl,
      }
      const result = await verifyFact(
        router,
        fact,
        snapshot,
        primaryProviderId,
        config.promptsDir,
        { today },
      )
      if (result.status !== "verified") allVerified = false
    }

    if (allVerified) verifiedFields.add("deadline")
  }

  const applyPresent = sanitized.cycles.some((cycle) => cycle.apply.url !== null)
  if (applyPresent) {
    let allVerified = true

    for (const cycle of sanitized.cycles) {
      const value = cycle.apply.url
      if (value === null) continue

      const evidence = cycle.evidence.find((item) => item.field === "applyUrl")
      if (
        evidence === undefined ||
        !quoteAppearsIn(evidence.quote, snapshot.text) ||
        !isAllowedApplyUrl(value, source.officialHosts)
      ) {
        allVerified = false
        continue
      }

      const result = await verifyFact(
        router,
        {
          field: "applyUrl",
          value,
          quote: evidence.quote,
          sourceUrl: evidence.sourceUrl,
        },
        snapshot,
        primaryProviderId,
        config.promptsDir,
        { officialHosts: source.officialHosts, fetchImpl },
      )
      if (result.status !== "verified") allVerified = false
    }

    if (allVerified) verifiedFields.add("applyUrl")
  }

  for (const field of ["opens", "resultsDate", "studyStart"] as const) {
    const present = sanitized.cycles.some((cycle) => cycle.dates[field] !== null)
    if (!present) continue

    const allVerified = sanitized.cycles.every((cycle) => {
      const value = cycle.dates[field]
      if (value === null) return true

      const evidence = cycle.evidence.find((item) => item.field === field)
      return (
        evidence !== undefined &&
        quoteAppearsIn(evidence.quote, snapshot.text) &&
        quoteSupportsDate(evidence.quote, value) &&
        isPlausibleDate(value, today, DATE_WINDOWS[field])
      )
    })

    if (allVerified) verifiedFields.add(field)
  }

  let guideVerified = false
  if (sanitized.guide !== null) {
    guideVerified = GUIDE_FIELDS.every((field) => {
      const items = sanitized.guide![field].filter((item) => item.trim().length > 0)
      if (items.length === 0) return true

      return sanitized.cycles.some((cycle) =>
        cycle.evidence.some(
          (evidence) =>
            evidence.field === `guide.${field}` &&
            quoteAppearsIn(evidence.quote, snapshot.text),
        ),
      )
    })
  }

  return { extraction: sanitized, verifiedFields, guideVerified }
}

function providerStats(
  state: ReturnType<StateStore["get"]>,
  today: string,
  now: Date,
): RunReport["providers"] {
  const result: RunReport["providers"] = {}

  for (const [providerId, usage] of Object.entries(state.providers)) {
    result[providerId] = {
      calls: usage.callsByDay[today] ?? 0,
      errors: usage.lastError === null ? 0 : 1,
      cooldowns:
        usage.cooldownUntil !== null && Date.parse(usage.cooldownUntil) > now.getTime() ? 1 : 0,
    }
  }

  return result
}

/**
 * Run one pass over the registry. Returns both the short summary used by the
 * CLI and the full report written to `pipeline/runs/`.
 */
export async function runPipeline(options: RunOptions): Promise<RunResult> {
  const { config, router, now, dryRun, maxItems, sourceId, allowLive } = options
  const discoveryEnabled = options.discovery ?? true
  const fetchImpl = options.fetchImpl ?? fetch
  const startedAt = now.toISOString()
  const today = todayInPakistan(now)
  const runId = startedAt.replace(/[:.]/g, "-")

  const baseStore = options.store ?? createFileStore(config.statePath)
  const store = dryRun ? createMemoryStore(baseStore.get()) : baseStore

  clearRobotsCache()

  const sources = loadSources(config.registryPath)
  const activeSources = sources.filter(
    (source) =>
      !source.archived && (sourceId === undefined || source.sourceId === sourceId),
  )

  const programs = new Map<string, Program>()
  if (existsSync(config.dataDir)) {
    for (const program of loadProgramsFrom(config.dataDir)) {
      programs.set(program.programId, program)
    }
  }

  let state = startOrResumeRun(store.get(), runId, startedAt)
  store.set(state)
  const currentRunId = state.run!.runId

  const published: string[] = []
  const unchanged: string[] = []
  const paused: string[] = []
  const skipped: string[] = []
  const failed: { item: string; error: string }[] = []
  const unhealthy = new Set<string>()
  const review: RunReport["review"] = []
  const sourceStats: RunReport["sources"] = {}
  let checked = 0
  let processed = 0
  let status: RunStatus = "running"
  let discoveryResult: DiscoveryResult | null = null
  const discoveryErrors: string[] = []

  const commit = (next: ReturnType<StateStore["get"]>): void => {
    state = next
    store.set(next)
  }

  const statFor = (id: string): RunReport["sources"][string] => {
    sourceStats[id] ??= { fetched: 0, published: 0, failed: 0 }
    return sourceStats[id]!
  }

  const queue: Array<{ source: SourceConfig; url: string }> = []
  for (const source of activeSources) {
    if (source.programId === null) continue

    for (const url of source.pageUrls) {
      const key = itemKey(source.sourceId, url)
      const item = state.run!.items[key]
      if (item?.state === "published" || item?.state === "dead") continue
      queue.push({ source, url })
    }
  }

  try {
    for (const { source, url } of queue) {
      if (processed >= maxItems) break

      const key = itemKey(source.sourceId, url)

      if (!sourceIsHealthy(source, state, now)) {
        unhealthy.add(source.sourceId)
        skipped.push(key)
        continue
      }

      processed += 1
      statFor(source.sourceId)

      try {
        let allowed = false
        try {
          allowed = await robotsAllows(url, {
            fetchImpl,
            userAgent: config.userAgent,
            timeoutMs: 15_000,
          })
        } catch {
          allowed = false
        }

        if (!allowed) {
          const message = "robots.txt disallows this URL"
          const previous = state.run!.items[key]
          commit(
            updateItem(state, key, {
              state: "dead",
              attempts: (previous?.attempts ?? 0) + 1,
              lastError: message,
              updatedAt: startedAt,
            }),
          )
          failed.push({ item: key, error: message })
          statFor(source.sourceId).failed += 1
          continue
        }

        let snapshot: PageSnapshot
        try {
          snapshot = await fetchText(url, {
            fetchImpl,
            timeoutMs: config.requestTimeoutMs,
            maxAttempts: config.maxAttempts,
            userAgent: config.userAgent,
            sleep: options.sleep,
            random: options.random,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          commit(recordSourceFailure(state, source.sourceId, startedAt))
          commit(markItemFailed(state, key, message, startedAt, config.maxAttempts, false))
          failed.push({ item: key, error: message })
          statFor(source.sourceId).failed += 1
          continue
        }

        checked += 1
        statFor(source.sourceId).fetched += 1

        const previousPage = state.pages[key]

        if (previousPage !== undefined && previousPage.hash === snapshot.hash) {
          commit(
            updateItem(state, key, {
              state: "published",
              hash: snapshot.hash,
              lastError: null,
              updatedAt: startedAt,
            }),
          )
          commit(updatePage(state, key, snapshot, startedAt))
          commit(resetSourceHealth(state, source.sourceId, startedAt))
          unchanged.push(source.programId!)
          statFor(source.sourceId).published += 1
          continue
        }

        // Monitor-only sources have no machine-readable cycle. Store the hash
        // and ask a human to review a change; never extract or publish.
        if (source.mode === "monitor") {
          if (previousPage !== undefined && previousPage.hash !== snapshot.hash) {
            review.push({
              sourceId: source.sourceId,
              url,
              reason: "Official page changed; review the cycle and guide by hand",
            })
          } else {
            unchanged.push(source.programId!)
          }
          commit(
            updateItem(state, key, {
              state: "published",
              hash: snapshot.hash,
              lastError: null,
              updatedAt: startedAt,
            }),
          )
          commit(updatePage(state, key, snapshot, startedAt))
          commit(resetSourceHealth(state, source.sourceId, startedAt))
          continue
        }

        const suspicious =
          snapshot.text.length < MIN_PAGE_LENGTH ||
          (previousPage !== undefined &&
            previousPage.textLength > 0 &&
            snapshot.text.length < previousPage.textLength * 0.4)

        if (suspicious) {
          const message = `Suspicious page: ${snapshot.text.length} characters`
          commit(recordSourceFailure(state, source.sourceId, startedAt))
          commit(markItemFailed(state, key, message, startedAt, config.maxAttempts, false))
          failed.push({ item: key, error: message })
          statFor(source.sourceId).failed += 1
          continue
        }

        let extraction: Extraction
        let primaryProviderId: ProviderId

        try {
          const response = await router.complete(
            buildExtractRequest(source, snapshot, config.promptsDir),
          )
          primaryProviderId = response.providerId
          extraction = parseExtraction(response.text)

          const errors = validateExtraction(extraction, snapshot, source)
          if (errors.length > 0) {
            throw new Error(errors.join("; "))
          }
        } catch (err) {
          if (err instanceof ProvidersExhaustedError) throw err
          const message = err instanceof Error ? err.message : String(err)
          commit(markItemFailed(state, key, message, startedAt, config.maxAttempts))
          failed.push({ item: key, error: message })
          statFor(source.sourceId).failed += 1
          continue
        }

        const program = programs.get(source.programId!)
        if (program === undefined) {
          const message = `No published program for ${source.programId}`
          commit(markItemFailed(state, key, message, startedAt, config.maxAttempts))
          failed.push({ item: key, error: message })
          statFor(source.sourceId).failed += 1
          continue
        }

        const verified = await verifyExtraction(
          router,
          source,
          snapshot,
          extraction,
          primaryProviderId,
          config,
          today,
          fetchImpl,
        )

        const merged = mergeExtraction(program, verified.extraction, source, {
          today,
          now,
          verifiedFields: verified.verifiedFields,
          guideVerified: verified.guideVerified,
        })

        if (!dryRun) writeProgramFile(merged, config.dataDir)
        programs.set(merged.programId, merged)

        commit(
          updateItem(state, key, {
            state: "published",
            hash: snapshot.hash,
            lastError: null,
            updatedAt: startedAt,
          }),
        )
        commit(updatePage(state, key, snapshot, startedAt))
        commit(resetSourceHealth(state, source.sourceId, startedAt))
        published.push(merged.programId)
        statFor(source.sourceId).published += 1
      } catch (err) {
        if (err instanceof ProvidersExhaustedError) {
          commit(
            updateItem(state, key, {
              state: "pending",
              lastError: err.message,
              updatedAt: startedAt,
            }),
          )
          paused.push(key)
          status = "paused"
          break
        }

        const message = err instanceof Error ? err.message : String(err)
        commit(markItemFailed(state, key, message, startedAt, config.maxAttempts))
        failed.push({ item: key, error: message })
        statFor(source.sourceId).failed += 1
      }
    }
  } finally {
    // Discovery is a review queue, never a publication. It runs after the
    // known-program queue, is skipped by dry runs, and its failures are
    // reported without failing the run.
    if (
      discoveryEnabled &&
      status !== "paused" &&
      !dryRun &&
      !(checked === 0 && failed.length > 0)
    ) {
      try {
        discoveryResult = await runDiscovery({
          config,
          router,
          store,
          sources: activeSources,
          now,
          fetchImpl,
          sleep: options.sleep,
          random: options.random,
        })
      } catch (err) {
        discoveryErrors.push(err instanceof Error ? err.message : String(err))
      }
      state = store.get()
    }

    if (status !== "paused") {
      status = checked === 0 && failed.length > 0 ? "failed" : "complete"
    }

    state = {
      ...state,
      run: state.run === null ? null : { ...state.run, status },
      lastSuccessfulRun:
        status === "complete" && failed.length === 0 ? startedAt : state.lastSuccessfulRun,
    }
    store.set(state)

    if (
      allowLive &&
      !dryRun &&
      status === "complete" &&
      checked > 0 &&
      failed.length === 0 &&
      unhealthy.size === 0
    ) {
      setRunStatusLive(config.runStatusPath, now)
    }
  }

  const discoveryQuiet =
    discoveryResult === null ||
    (discoveryResult.stopReason === "none" &&
      discoveryResult.fetched === 0 &&
      discoveryResult.accepted.length === 0 &&
      discoveryResult.errors.length === 0)
  const discoveryReport: DiscoveryRunReport | null =
    discoveryQuiet && discoveryErrors.length === 0
      ? null
      : {
          rounds: discoveryResult?.rounds ?? [],
          fetched: discoveryResult?.fetched ?? 0,
          accepted: discoveryResult?.accepted.length ?? 0,
          queries: discoveryResult?.queries ?? [],
          stopReason: discoveryResult?.stopReason ?? "none",
          errors: [...(discoveryResult?.errors ?? []), ...discoveryErrors],
        }

  const report: RunReport = {
    runId: currentRunId,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    published,
    unchanged,
    skipped,
    failed,
    paused,
    unhealthy: [...unhealthy],
    review,
    candidates: discoveryResult?.accepted.length ?? 0,
    checked,
    sources: sourceStats,
    providers: providerStats(state, today, now),
    discovery: discoveryReport,
  }

  if (!dryRun) writeReport(config, report)

  return {
    summary: {
      runId: currentRunId,
      status,
      published,
      unchanged,
      failed: failed.map((item) => item.item),
      paused,
      unhealthy: [...unhealthy],
      review: review.map((item) => item.url),
      candidates: discoveryResult?.accepted.length ?? 0,
      checked,
    },
    report,
  }
}
