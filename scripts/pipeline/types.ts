// Shared types for the data pipeline. Browser code must never import this
// module; it is Node-only and describes the robot's contracts.

export type AiTask = 'extract' | 'extract-long' | 'verify' | 'discover'

export type ProviderId = 'gemini' | 'groq' | 'cloudflare' | 'openrouter'

export type RunStatus = 'running' | 'paused' | 'complete' | 'failed'

export type ItemState =
  | 'pending'
  | 'fetched'
  | 'extracted'
  | 'verified'
  | 'published'
  | 'failed'
  | 'dead'

/**
 * `extract` reads facts and publishes them. `monitor` only watches the page
 * hash and asks a human to review a change; use it for official pages that do
 * not publish a machine-readable cycle.
 */
export type SourceMode = 'extract' | 'monitor'

export interface SourceConfig {
  sourceId: string
  programId: string | null
  provider: string
  officialHosts: string[]
  pageUrls: string[]
  indexUrls: string[]
  discovery: boolean
  archived: boolean
  mode: SourceMode
}

export interface PageSnapshot {
  url: string
  finalUrl: string
  status: number
  contentType: string
  hash: string
  text: string
  /** Raw HTML for discovery link extraction; absent for PDFs and plain text. */
  html?: string
}

export interface EvidenceFact {
  field: string
  quote: string
  sourceUrl: string
}

export interface ExtractedCycle {
  /** Null when the page does not name the intake; the publisher derives a label. */
  label: string | null
  /** Explicit page state in words. Dates win when the page also gives them. */
  status: 'open' | 'upcoming' | 'closed' | null
  dates: {
    opens: string | null
    deadline: string | null
    resultsDate: string | null
    studyStart: string | null
  }
  apply: {
    url: string | null
    portalName: string | null
    fee: string | null
  }
  evidence: EvidenceFact[]
}

export interface Guide {
  steps: string[]
  documents: string[]
  tips: string[]
  timeline: string[]
}

export interface Extraction {
  pageKind: 'program' | 'index' | 'unknown'
  cycles: ExtractedCycle[]
  guide: Guide | null
}

export interface AiRequest {
  task: AiTask
  system: string
  user: string
  temperature: number
  maxOutputTokens: number
}

export interface AiResponse {
  text: string
  providerId: ProviderId
  model: string
  keyLabel?: string
}

export interface Router {
  complete(request: AiRequest, options?: { exclude?: ProviderId[] }): Promise<AiResponse>
  available(task: AiTask, exclude?: ProviderId[]): ProviderId[]
}

export interface Provider {
  id: ProviderId
  model: string
  complete(request: AiRequest, signal: AbortSignal): Promise<string>
}

export interface ProviderKeyConfig {
  label: string
  apiKey: string
}

export interface ProviderSettings {
  apiKey: string
  model: string
  accountId?: string
  keys?: ProviderKeyConfig[]
}

export interface PipelineConfig {
  dataDir: string
  statePath: string
  registryPath: string
  candidatesPath: string
  runStatusPath: string
  reportsDir: string
  promptsDir: string
  providers: Partial<Record<ProviderId, ProviderSettings>>
  routing: Record<AiTask, ProviderId[]>
  dailyCallLimit: number
  maxAttempts: number
  requestTimeoutMs: number
  userAgent: string
}

export interface ItemCheckpoint {
  state: ItemState
  attempts: number
  hash: string | null
  lastError: string | null
  updatedAt: string
}

export interface RunCheckpoint {
  runId: string
  startedAt: string
  status: RunStatus
  items: Record<string, ItemCheckpoint>
}

export interface PageHealth {
  hash: string
  textLength: number
  lastFetchedAt: string
  failures: number
}

export interface SourceHealth {
  lastFetchedAt: string | null
  failures: number
  retired: boolean
  nextEligibleAt: string | null
}

export interface KeyUsage {
  callsByDay: Record<string, number>
  cooldownUntil: string | null
  lastError: string | null
}

export interface ProviderUsage {
  callsByDay: Record<string, number>
  cooldownUntil: string | null
  lastError: string | null
  keys?: Record<string, KeyUsage>
}

export type DiscoveredVia =
  | 'sitemap'
  | 'rss'
  | 'index'
  | 'wayback-cdx'
  | 'commoncrawl-cdx'
  | 'search'

export interface DiscoveryQuery {
  id: string
  text: string
  round: number
  origin: 'seed' | 'gap'
  createdAt: string
}

export interface DiscoverySeenUrl {
  firstSeenAt: string
  status: number | null
  contentHash?: string
}

export interface DiscoveryHostHealth {
  lastFetchedAt: string | null
  failures: number
  nextEligibleAt: string | null
}

export interface DiscoveryState {
  seenUrls: Record<string, DiscoverySeenUrl>
  queries: DiscoveryQuery[]
  hostHealth: Record<string, DiscoveryHostHealth>
}

export interface PipelineState {
  version: 1
  run: RunCheckpoint | null
  pages: Record<string, PageHealth>
  sources: Record<string, SourceHealth>
  providers: Record<string, ProviderUsage>
  discovery: DiscoveryState
  lastSuccessfulRun: string | null
}

export interface Candidate {
  candidateId: string
  title: string
  provider: string
  country: string | null
  officialUrl: string
  deadline: string | null
  applyUrl: string | null
  evidence: EvidenceFact[]
  sourceId: string
  discoveredAt: string
  status: 'pending-review'
  foundByQuery?: string | null
  discoveredVia?: DiscoveredVia
  firstSeenAt?: string
  discoveryScore?: number
}

export interface DiscoveryRunReport {
  rounds: Array<{
    round: number
    queries: string[]
    fetched: number
    accepted: number
    gaps: string[]
    stopReason: string | null
  }>
  fetched: number
  accepted: number
  queries: string[]
  stopReason: string
  errors: string[]
}

export interface RunReport {
  runId: string
  startedAt: string
  finishedAt: string
  status: RunStatus
  published: string[]
  unchanged: string[]
  skipped: string[]
  failed: { item: string; error: string }[]
  paused: string[]
  unhealthy: string[]
  /** Monitor-only sources whose page changed; a human must review them. */
  review: { sourceId: string; url: string; reason: string }[]
  candidates: number
  checked: number
  sources: Record<string, { fetched: number; published: number; failed: number }>
  providers: Record<
    string,
    {
      calls: number
      errors: number
      cooldowns: number
      keys?: Record<string, { calls: number; errors: number; cooling: boolean }>
    }
  >
  discovery: DiscoveryRunReport | null
}

export interface RunSummary {
  runId: string
  status: RunStatus
  published: string[]
  unchanged: string[]
  failed: string[]
  paused: string[]
  unhealthy: string[]
  review: string[]
  candidates: number
  checked: number
}
