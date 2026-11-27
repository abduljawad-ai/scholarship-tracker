// Browser-safe, on-device application tracker. No node:* imports and no seed
// data — Task 11's My Applications page consumes this same module.

export type TrackerStatus = 'saved' | 'applied' | 'interview' | 'offer' | 'rejected'

export interface TrackerEntry {
  programId: string
  cycleId: string
  status: TrackerStatus
  note: string
  updatedAt: string
}

export interface TrackerState {
  version: 1
  entries: TrackerEntry[]
}

export const TRACKER_STORAGE_KEY = 'scholarship-tracker:v1'

const STATUSES: readonly TrackerStatus[] = [
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
]

/** Raised when a backup code cannot be decoded into valid tracker state. */
export class TrackerImportError extends Error {
  constructor(message = 'Invalid tracker code') {
    super(message)
    this.name = 'TrackerImportError'
  }
}

function emptyState(): TrackerState {
  return { version: 1, entries: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEntry(value: unknown): value is TrackerEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.programId === 'string' &&
    value.programId.length > 0 &&
    typeof value.cycleId === 'string' &&
    value.cycleId.length > 0 &&
    typeof value.status === 'string' &&
    (STATUSES as readonly string[]).includes(value.status) &&
    typeof value.note === 'string' &&
    typeof value.updatedAt === 'string' &&
    value.updatedAt.length > 0
  )
}

/** Returns a defensive copy of validated state, or undefined if shape is wrong. */
function parseState(value: unknown): TrackerState | undefined {
  if (!isRecord(value)) return undefined
  if (value.version !== 1) return undefined
  if (!Array.isArray(value.entries) || !value.entries.every(isEntry)) return undefined
  return {
    version: 1,
    entries: value.entries.map((entry) => ({ ...entry })),
  }
}

function readStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function writeStorage(): Pick<Storage, 'setItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Reads tracker state. Corrupt, wrong-version or unavailable data is ignored. */
export function loadTracker(storage?: Pick<Storage, 'getItem'>): TrackerState {
  const target = storage ?? readStorage()
  if (!target) return emptyState()
  try {
    const raw = target.getItem(TRACKER_STORAGE_KEY)
    if (raw === null) return emptyState()
    const parsed: unknown = JSON.parse(raw)
    return parseState(parsed) ?? emptyState()
  } catch {
    // Private mode, blocked storage, bad JSON — never interrupt the UI.
    return emptyState()
  }
}

/** Persists state. Write failures (quota, blocked storage) are swallowed. */
export function saveTracker(state: TrackerState, storage?: Pick<Storage, 'setItem'>): void {
  const target = storage ?? writeStorage()
  if (!target) return
  try {
    target.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The in-memory state stays usable for this visit.
  }
}

/** Adds or replaces the entry for one program/cycle without mutating `state`. */
export function upsertEntry(state: TrackerState, entry: TrackerEntry): TrackerState {
  const entries = state.entries.slice()
  const index = entries.findIndex(
    (existing) => existing.programId === entry.programId && existing.cycleId === entry.cycleId,
  )
  const next = { ...entry }
  if (index === -1) entries.push(next)
  else entries[index] = next
  return { version: 1, entries }
}

/** Removes only the entry matching both ids, without mutating `state`. */
export function removeEntry(state: TrackerState, programId: string, cycleId: string): TrackerState {
  return {
    version: 1,
    entries: state.entries.filter(
      (entry) => !(entry.programId === programId && entry.cycleId === cycleId),
    ),
  }
}

function encodeBase64(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

function decodeBase64(code: string): string {
  const binary = atob(code)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

/** Base64 of the UTF-8 JSON state (non-ASCII notes are preserved). */
export function exportTracker(state: TrackerState): string {
  return encodeBase64(JSON.stringify(state))
}

/** Decodes and validates a backup code, or throws TrackerImportError. */
export function importTracker(code: string): TrackerState {
  try {
    if (typeof code !== 'string' || code.trim() === '') throw new TrackerImportError()
    const parsed: unknown = JSON.parse(decodeBase64(code.trim()))
    const state = parseState(parsed)
    if (state === undefined) throw new TrackerImportError()
    return state
  } catch (error) {
    if (error instanceof TrackerImportError) throw error
    throw new TrackerImportError(`Invalid tracker code: ${error instanceof Error ? error.message : String(error)}`)
  }
}
