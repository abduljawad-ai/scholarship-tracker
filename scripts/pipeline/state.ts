// Checkpoint state for the daily run. Committed to the repository so a run
// that pauses on quota exhaustion resumes exactly where it stopped.
//
// Every update is immutable: callers get a new state object, which makes the
// orchestrator's "persist once per item" rule easy to reason about.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import type {
  DiscoveryState,
  ItemCheckpoint,
  KeyUsage,
  PipelineState,
  ProviderId,
  ProviderUsage,
} from "./types"

export class StateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StateError"
  }
}

const ItemCheckpointSchema = z
  .object({
    state: z.enum([
      "pending",
      "fetched",
      "extracted",
      "verified",
      "published",
      "failed",
      "dead",
    ]),
    attempts: z.number().int().min(0),
    hash: z.string().nullable(),
    lastError: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict()

const RunCheckpointSchema = z
  .object({
    runId: z.string().min(1),
    startedAt: z.string(),
    status: z.enum(["running", "paused", "complete", "failed"]),
    items: z.record(z.string(), ItemCheckpointSchema),
  })
  .strict()

const PageHealthSchema = z
  .object({
    hash: z.string(),
    textLength: z.number().int().min(0),
    lastFetchedAt: z.string(),
    failures: z.number().int().min(0),
  })
  .strict()

const SourceHealthSchema = z
  .object({
    lastFetchedAt: z.string().nullable(),
    failures: z.number().int().min(0),
    retired: z.boolean(),
    nextEligibleAt: z.string().nullable(),
  })
  .strict()

const KeyUsageSchema = z
  .object({
    callsByDay: z.record(z.string(), z.number().int().min(0)),
    cooldownUntil: z.string().nullable(),
    lastError: z.string().nullable(),
  })
  .strict()

const ProviderUsageSchema = z
  .object({
    callsByDay: z.record(z.string(), z.number().int().min(0)),
    cooldownUntil: z.string().nullable(),
    lastError: z.string().nullable(),
    keys: z.record(z.string(), KeyUsageSchema).optional(),
  })
  .strict()

const DiscoveryQuerySchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    round: z.number().int().min(1),
    origin: z.enum(["seed", "gap"]),
    createdAt: z.string(),
  })
  .strict()

const DiscoverySeenUrlSchema = z
  .object({
    firstSeenAt: z.string(),
    status: z.number().int().nullable(),
    contentHash: z.string().optional(),
  })
  .strict()

const DiscoveryHostHealthSchema = z
  .object({
    lastFetchedAt: z.string().nullable(),
    failures: z.number().int().min(0),
    nextEligibleAt: z.string().nullable(),
  })
  .strict()

const DiscoveryStateSchema = z
  .object({
    seenUrls: z.record(z.string(), DiscoverySeenUrlSchema),
    queries: z.array(DiscoveryQuerySchema),
    hostHealth: z.record(z.string(), DiscoveryHostHealthSchema),
  })
  .strict()

const PipelineStateSchema = z
  .object({
    version: z.literal(1),
    run: RunCheckpointSchema.nullable(),
    pages: z.record(z.string(), PageHealthSchema),
    sources: z.record(z.string(), SourceHealthSchema),
    providers: z.record(z.string(), ProviderUsageSchema),
    // Optional so state written before discovery existed still loads.
    discovery: DiscoveryStateSchema.optional(),
    lastSuccessfulRun: z.string().nullable(),
  })
  .strict()

export function emptyDiscovery(): DiscoveryState {
  return { seenUrls: {}, queries: [], hostHealth: {} }
}

export function emptyState(): PipelineState {
  return {
    version: 1,
    run: null,
    pages: {},
    sources: {},
    providers: {},
    discovery: emptyDiscovery(),
    lastSuccessfulRun: null,
  }
}

/**
 * Shared mutable state used by the orchestrator and the router. Both write
 * through the same store, so an item checkpoint and a provider call cannot
 * clobber each other.
 */
export interface StateStore {
  get(): PipelineState
  set(next: PipelineState): void
}

export function createMemoryStore(initial: PipelineState = emptyState()): StateStore {
  let state = initial
  return {
    get: () => state,
    set: (next) => {
      state = next
    },
  }
}

export function createFileStore(file: string, initial: PipelineState = loadState(file)): StateStore {
  let state = initial
  return {
    get: () => state,
    set: (next) => {
      state = next
      saveState(file, next)
    },
  }
}

export function loadState(file: string): PipelineState {
  if (!existsSync(file)) return emptyState()

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new StateError(`Invalid pipeline state at ${file}: ${message}`)
  }

  const parsed = PipelineStateSchema.safeParse(raw)
  if (!parsed.success) {
    throw new StateError(`Invalid pipeline state at ${file}: ${parsed.error.message}`)
  }
  return { ...parsed.data, discovery: parsed.data.discovery ?? emptyDiscovery() }
}

/** Atomic write: a crash never leaves a half-written checkpoint. */
export function saveState(file: string, state: PipelineState): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(tmp, file)
}

/** Page hashes are keyed per source so two programs may share one URL. */
export function itemKey(sourceId: string, url: string): string {
  return `${sourceId}::${url}`
}

/**
 * Keep a run that is still running or paused; start a fresh one after a
 * complete or failed run. Failed items carry their attempt count into the new
 * run so dead-lettering works across days; published items are re-checked.
 */
export function startOrResumeRun(
  state: PipelineState,
  runId: string,
  startedAt: string,
): PipelineState {
  if (state.run && (state.run.status === "running" || state.run.status === "paused")) {
    return state
  }

  const carried: Record<string, ItemCheckpoint> = {}
  for (const [key, item] of Object.entries(state.run?.items ?? {})) {
    if (item.state === "failed" || item.state === "pending") {
      carried[key] = item
    }
  }

  return {
    ...state,
    run: { runId, startedAt, status: "running", items: carried },
  }
}

export function updateItem(
  state: PipelineState,
  key: string,
  patch: Partial<ItemCheckpoint>,
): PipelineState {
  if (!state.run) {
    throw new StateError("Cannot update an item without an active run")
  }

  const previous: ItemCheckpoint = state.run.items[key] ?? {
    state: "pending",
    attempts: 0,
    hash: null,
    lastError: null,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  }

  return {
    ...state,
    run: {
      ...state.run,
      items: {
        ...state.run.items,
        [key]: { ...previous, ...patch },
      },
    },
  }
}

function providerUsage(state: PipelineState, providerId: ProviderId): ProviderUsage {
  return (
    state.providers[providerId] ?? {
      callsByDay: {},
      cooldownUntil: null,
      lastError: null,
    }
  )
}

export function recordProviderCall(
  state: PipelineState,
  providerId: ProviderId,
  day: string,
  keyLabel?: string,
): PipelineState {
  const usage = providerUsage(state, providerId)
  let keys = usage.keys
  if (keyLabel) {
    const keyData = keys?.[keyLabel] ?? {
      callsByDay: {},
      cooldownUntil: null,
      lastError: null,
    }
    keys = {
      ...keys,
      [keyLabel]: {
        ...keyData,
        callsByDay: {
          ...keyData.callsByDay,
          [day]: (keyData.callsByDay[day] ?? 0) + 1,
        },
      },
    }
  }

  return {
    ...state,
    providers: {
      ...state.providers,
      [providerId]: {
        ...usage,
        callsByDay: {
          ...usage.callsByDay,
          [day]: (usage.callsByDay[day] ?? 0) + 1,
        },
        ...(keys ? { keys } : {}),
      },
    },
  }
}

export function setProviderCooldown(
  state: PipelineState,
  providerId: ProviderId,
  until: string,
  lastError?: string | null,
): PipelineState {
  const usage = providerUsage(state, providerId)
  return {
    ...state,
    providers: {
      ...state.providers,
      [providerId]: {
        ...usage,
        cooldownUntil: until,
        lastError: lastError === undefined ? usage.lastError : lastError,
      },
    },
  }
}

export function setKeyCooldown(
  state: PipelineState,
  providerId: ProviderId,
  keyLabel: string,
  until: string,
  lastError?: string | null,
): PipelineState {
  const usage = providerUsage(state, providerId)
  const existingKey = usage.keys?.[keyLabel] ?? {
    callsByDay: {},
    cooldownUntil: null,
    lastError: null,
  }

  const updatedKey: KeyUsage = {
    ...existingKey,
    cooldownUntil: until,
    lastError: lastError === undefined ? existingKey.lastError : lastError,
  }

  const keys = {
    ...usage.keys,
    [keyLabel]: updatedKey,
  }

  return {
    ...state,
    providers: {
      ...state.providers,
      [providerId]: {
        ...usage,
        lastError: lastError === undefined ? usage.lastError : lastError,
        keys,
      },
    },
  }
}

export function keyReady(
  state: PipelineState,
  providerId: ProviderId,
  keyLabel: string,
  now: Date,
  // Pooled keys are cooled individually. A provider-wide cooldown left by an
  // older single-key config must not lock out healthy keys in the pool.
  ignoreProviderCooldown = false,
): boolean {
  const keyUsage = state.providers[providerId]?.keys?.[keyLabel]
  if (keyUsage && keyUsage.cooldownUntil !== null) {
    const untilMs = Date.parse(keyUsage.cooldownUntil)
    if (!Number.isNaN(untilMs) && untilMs > now.getTime()) {
      return false
    }
  }

  if (ignoreProviderCooldown) return true

  const providerUntil = state.providers[providerId]?.cooldownUntil
  if (providerUntil !== null && providerUntil !== undefined) {
    const providerUntilMs = Date.parse(providerUntil)
    if (!Number.isNaN(providerUntilMs) && providerUntilMs > now.getTime()) {
      return false
    }
  }

  return true
}

export function providerReady(
  state: PipelineState,
  providerId: ProviderId,
  now: Date,
): boolean {
  const usage = state.providers[providerId]
  if (!usage) return true

  if (usage.keys && Object.keys(usage.keys).length > 0) {
    const hasReadyKey = Object.keys(usage.keys).some((label) =>
      keyReady(state, providerId, label, now),
    )
    if (hasReadyKey) return true
  }

  const until = usage.cooldownUntil
  if (until === null || until === undefined) return true

  const untilMs = Date.parse(until)
  if (Number.isNaN(untilMs)) return true
  return untilMs <= now.getTime()
}

/** Total AI calls recorded on a Pakistan calendar day, across providers. */
export function callsOn(state: PipelineState, day: string): number {
  return Object.values(state.providers).reduce(
    (total, usage) => total + (usage.callsByDay[day] ?? 0),
    0,
  )
}
