// Agentic discovery: a bounded loop that reads publisher-declared surfaces
// (index pages, RSS/Atom, sitemaps), scores links deterministically, fetches a
// small slice, and asks the model to classify pages in batches. It only queues
// `pending-review` candidates. It never writes `src/data/programs/`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { todayInPakistan } from "../../src/lib/cycle-status"
import { isPlausibleDeadline, quoteSupportsDate } from "./dates"
import { FetchError, fetchText, robotsAllows, type FetchLike } from "./fetch"
import { extractLinks } from "./html"
import { loadPrompt, renderPrompt } from "./prompts"
import { emptyDiscovery, type StateStore } from "./state"
import { normalizeUrl, quoteAppearsIn } from "./text"
import type {
  Candidate,
  DiscoveredVia,
  DiscoveryHostHealth,
  DiscoveryQuery,
  DiscoveryState,
  EvidenceFact,
  PageSnapshot,
  PipelineConfig,
  PipelineState,
  Router,
  SourceConfig,
} from "./types"
import { isAllowedApplyUrl, isAllowedHost } from "./urls"

export { normalizeUrl }

// ---------------------------------------------------------------------------
// Candidate storage
// ---------------------------------------------------------------------------

const HttpUrl = z.string().regex(/^https?:\/\/\S+$/, "expected an http(s) URL")
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

const EvidenceSchema = z
  .object({
    field: z.string().min(1),
    quote: z.string().min(1),
    sourceUrl: z.string().min(1),
  })
  .strict()

const DiscoveredViaSchema = z.enum([
  "sitemap",
  "rss",
  "index",
  "wayback-cdx",
  "commoncrawl-cdx",
  "search",
])

export const CandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    title: z.string().min(1),
    provider: z.string().min(1),
    country: z.string().min(1).nullable(),
    officialUrl: HttpUrl,
    deadline: IsoDate.nullable(),
    applyUrl: HttpUrl.nullable(),
    evidence: z.array(EvidenceSchema).min(1),
    sourceId: z.string().min(1),
    discoveredAt: z.string().min(1),
    status: z.literal("pending-review"),
    foundByQuery: z.string().nullable().optional(),
    discoveredVia: DiscoveredViaSchema.optional(),
    firstSeenAt: z.string().optional(),
    discoveryScore: z.number().optional(),
  })
  .strict()

const CandidatesFileSchema = z
  .object({
    version: z.literal(1),
    candidates: z.array(CandidateSchema),
  })
  .strict()

export class DiscoveryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DiscoveryParseError"
  }
}

/** Parse a candidates file (or the JSON body of one) and validate every item. */
export function parseCandidates(text: string): Candidate[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new DiscoveryParseError(`Invalid JSON in candidates file: ${message}`)
  }

  if (Array.isArray(raw)) {
    const parsed = z.array(CandidateSchema).safeParse(raw)
    if (!parsed.success) {
      throw new DiscoveryParseError(`Candidate schema violation: ${parsed.error.message}`)
    }
    return parsed.data
  }

  const parsed = CandidatesFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DiscoveryParseError(`Candidate schema violation: ${parsed.error.message}`)
  }
  return parsed.data.candidates
}

export function loadCandidates(file: string): Candidate[] {
  if (!existsSync(file)) return []
  return parseCandidates(readFileSync(file, "utf8"))
}

/** Atomic write: a crash never leaves a half-written review queue. */
export function saveCandidates(file: string, candidates: Candidate[]): void {
  const parsed = z.array(CandidateSchema).safeParse(candidates)
  if (!parsed.success) {
    throw new DiscoveryParseError(`Candidate schema violation: ${parsed.error.message}`)
  }

  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify({ version: 1, candidates: parsed.data }, null, 2)}\n`, "utf8")
  renameSync(temp, file)
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Add new candidates without duplicating a URL or a near-identical title.
 * Existing entries win; the pending cap keeps human review tractable.
 */
export function mergeCandidates(
  existing: Candidate[],
  incoming: Candidate[],
  maxPending: number,
): Candidate[] {
  const result = [...existing]
  const urls = new Set(existing.map((item) => normalizeUrl(item.officialUrl)))
  const titles = new Set(existing.map((item) => normalizeTitle(item.title)))
  const ids = new Set(existing.map((item) => item.candidateId))
  let pending = existing.filter((item) => item.status === "pending-review").length

  for (const item of incoming) {
    if (pending >= maxPending) break

    const url = normalizeUrl(item.officialUrl)
    const title = normalizeTitle(item.title)
    if (!url || !title || urls.has(url) || titles.has(title)) continue

    let id = item.candidateId
    let suffix = 2
    while (ids.has(id)) {
      id = `${item.candidateId}-${suffix}`
      suffix += 1
    }

    result.push({ ...item, candidateId: id })
    urls.add(url)
    titles.add(title)
    ids.add(id)
    pending += 1
  }

  return result
}

// ---------------------------------------------------------------------------
// URL surfaces and scoring
// ---------------------------------------------------------------------------

const STRONG_PATH = /(scholarship|scholarships|bursary|bursaries|grant|grants|award|awards|funding|fellowship|fellowships)/
const SECONDARY_PATH =
  /(financial[- ]?aid|fees|admissions?|prospectus|apply|applications?|international|students?|eligibility|study)/
const NEGATIVE_PATH = /(news|blog|press|event|events|alumni|donate|donation|login|account|privacy|terms|contact|about|careers?|staff)/
const MEDIA_EXTENSION =
  /\.(jpe?g|png|gif|svg|webp|ico|css|js|json|xml|zip|rar|7z|mp4|mp3|avi|mov|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i

const VIA_SCORE: Record<DiscoveredVia, number> = {
  sitemap: 2,
  rss: 4,
  index: 6,
  "wayback-cdx": 0,
  "commoncrawl-cdx": 0,
  search: 3,
}

export interface FrontierInput {
  url: string
  host: string
  allowedHosts: string[]
  discoveredVia: DiscoveredVia
  foundByQuery?: string | null
  lastmod?: string | null
  queryTerms?: string[]
  now?: Date
}

/**
 * Deterministic prefilter. Positive scores are worth fetching; negative scores
 * are noise (news, logins, media). The model never sees a URL for free.
 */
export function scoreFrontier(input: FrontierInput): number {
  if (!isAllowedHost(input.url, input.allowedHosts)) return -100

  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return -100
  }

  const pathname = parsed.pathname.toLowerCase()
  const haystack = `${pathname}${parsed.search.toLowerCase()}`
  let score = 0

  if (MEDIA_EXTENSION.test(pathname)) score -= 50
  if (STRONG_PATH.test(haystack)) score += 40
  else if (SECONDARY_PATH.test(haystack)) score += 15
  if (NEGATIVE_PATH.test(haystack)) score -= 25

  score += VIA_SCORE[input.discoveredVia]

  if (input.lastmod) {
    const lastmodMs = Date.parse(input.lastmod)
    const nowMs = (input.now ?? new Date()).getTime()
    if (!Number.isNaN(lastmodMs) && nowMs - lastmodMs <= 365 * 86_400_000) score += 8
    else if (!Number.isNaN(lastmodMs) && nowMs - lastmodMs <= 2 * 365 * 86_400_000) score += 4
  }

  for (const term of input.queryTerms ?? []) {
    if (term.length >= 4 && haystack.includes(term)) score += 5
  }

  if (pathname.split("/").filter(Boolean).length > 6) score -= 5
  return score
}

export function isDiscoveryUrl(url: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
    if (!isAllowedHost(url, allowedHosts)) return false
    if (MEDIA_EXTENSION.test(parsed.pathname)) return false
    return true
  } catch {
    return false
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim()
}

function absoluteHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export interface SitemapEntry {
  url: string
  lastmod: string | null
}

export interface ParsedSitemap {
  urls: string[]
  sitemaps: string[]
  entries: SitemapEntry[]
}

function locsIn(block: string, baseUrl: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  for (const match of block.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const url = absoluteHttpUrl(decodeXml(match[1] ?? ""), baseUrl)
    if (!url) continue
    const lastmodMatch = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block)
    entries.push({ url, lastmod: lastmodMatch ? decodeXml(lastmodMatch[1] ?? "") : null })
  }
  return entries
}

/** Read `<url><loc>` and `<sitemap><loc>` blocks; one sitemap index level is caller's job. */
export function parseSitemap(
  xml: string,
  baseUrl: string,
  allowedHosts?: string[],
): ParsedSitemap {
  const entries: SitemapEntry[] = []
  const sitemaps: string[] = []

  for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    entries.push(...locsIn(match[1] ?? "", baseUrl))
  }
  for (const match of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    for (const entry of locsIn(match[1] ?? "", baseUrl)) {
      sitemaps.push(entry.url)
    }
  }

  const filter = (url: string): boolean =>
    allowedHosts === undefined || allowedHosts.length === 0 || isAllowedHost(url, allowedHosts)

  const kept = entries.filter((entry) => filter(entry.url))
  return {
    urls: kept.map((entry) => entry.url),
    sitemaps: sitemaps.filter(filter),
    entries: kept,
  }
}

export function extractSitemapLinks(
  xml: string,
  baseUrl: string,
  allowedHosts?: string[],
): string[] {
  return parseSitemap(xml, baseUrl, allowedHosts).urls
}

/** RSS `<link>text</link>` and Atom `<link href="..."/>` entries. */
export function extractFeedLinks(xml: string, baseUrl: string): string[] {
  const links = new Set<string>()

  for (const match of xml.matchAll(/<link\b[^>]*>([\s\S]*?)<\/link>/gi)) {
    const url = absoluteHttpUrl(decodeXml(match[1] ?? ""), baseUrl)
    if (url) links.add(url)
  }
  for (const match of xml.matchAll(/<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const url = absoluteHttpUrl(decodeXml(match[1] ?? match[2] ?? ""), baseUrl)
    if (url) links.add(url)
  }

  return [...links]
}

/** `<link rel="alternate" type="application/rss+xml" href="...">` in a page head. */
export function extractFeedAlternates(html: string, baseUrl: string): string[] {
  const links = new Set<string>()

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    if (!rel || !type || !href) continue
    if (!/alternate/i.test(rel[1] ?? rel[2] ?? "")) continue
    if (!/(rss|atom)\+xml/i.test(type[1] ?? type[2] ?? "")) continue

    const url = absoluteHttpUrl(decodeXml(href[1] ?? href[2] ?? ""), baseUrl)
    if (url) links.add(url)
  }

  return [...links]
}

// ---------------------------------------------------------------------------
// Model prompts and parsing
// ---------------------------------------------------------------------------

const DiscoveredPageSchema = z
  .object({
    url: HttpUrl,
    isScholarship: z.boolean(),
    title: z.string().nullable(),
    provider: z.string().nullable(),
    country: z.string().nullable(),
    deadline: IsoDate.nullable(),
    applyUrl: HttpUrl.nullable(),
    evidence: z.array(EvidenceSchema),
  })
  .strict()

const GapResponseSchema = z
  .object({
    queries: z.array(z.string()),
  })
  .strict()

export interface DiscoveredPage {
  url: string
  isScholarship: boolean
  title: string | null
  provider: string | null
  country: string | null
  deadline: string | null
  applyUrl: string | null
  evidence: EvidenceFact[]
}

const DISCOVER_SYSTEM =
  "You classify official pages for a scholarship tracker. Return JSON only. Never use outside knowledge."
const GAP_SYSTEM =
  "You propose short search phrases for scholarship discovery. Return JSON only."

const PAGE_TEXT_LIMIT = 4_000
const TOTAL_TEXT_LIMIT = 30_000

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim()
}

function parseJsonValue(text: string, label: string): unknown {
  const cleaned = stripFences(text)
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"))
  if (start === -1 || end <= start) {
    throw new DiscoveryParseError(`No JSON value found in the ${label} output`)
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new DiscoveryParseError(`Invalid JSON from the ${label}: ${message}`)
  }
}

export function parseDiscoveryResponse(text: string): DiscoveredPage[] {
  const raw = parseJsonValue(text, "discovery")
  const pages = Array.isArray(raw)
    ? raw
    : (raw as { pages?: unknown } | null)?.pages

  const parsed = z.array(DiscoveredPageSchema).safeParse(pages)
  if (!parsed.success) {
    throw new DiscoveryParseError(`Discovery schema violation: ${parsed.error.message}`)
  }
  return parsed.data
}

export function parseGapResponse(text: string): string[] {
  const raw = parseJsonValue(text, "gap")
  const parsed = GapResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DiscoveryParseError(`Gap schema violation: ${parsed.error.message}`)
  }

  const seen = new Set<string>()
  const queries: string[] = []
  for (const value of parsed.data.queries) {
    const query = value.replace(/\s+/g, " ").trim()
    if (query.length < 3 || query.length > 80) continue
    if (/https?:\/\//i.test(query)) continue
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(query)
    if (queries.length >= 4) break
  }
  return queries
}

function pageTitle(html: string | undefined): string {
  if (!html) return ""
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? decodeXml(match[1] ?? "") : ""
}

export function buildDiscoverRequest(pages: PageSnapshot[], promptsDir: string): {
  task: "discover"
  system: string
  user: string
  temperature: number
  maxOutputTokens: number
} {
  const template = loadPrompt("discover", promptsDir)
  let used = 0
  const blocks = pages.map((page, index) => {
    const remaining = Math.max(0, TOTAL_TEXT_LIMIT - used)
    const text = page.text.slice(0, Math.min(PAGE_TEXT_LIMIT, remaining))
    used += text.length
    return `### Page ${index + 1}\nURL: ${page.finalUrl}\nTitle: ${pageTitle(page.html)}\nText:\n${text}`
  })

  return {
    task: "discover",
    system: DISCOVER_SYSTEM,
    user: renderPrompt(template, { pages: blocks.join("\n\n") }),
    temperature: 0,
    maxOutputTokens: 4096,
  }
}

export interface GapInput {
  accepted: Candidate[]
  rejected: { url: string; title: string }[]
  queries: string[]
}

export function buildGapRequest(input: GapInput, promptsDir: string): {
  task: "discover"
  system: string
  user: string
  temperature: number
  maxOutputTokens: number
} {
  const template = loadPrompt("discover-gaps", promptsDir)
  const accepted = input.accepted
    .slice(0, 10)
    .map((item) => `- ${item.title} — ${item.provider}`)
    .join("\n")
  const rejected = input.rejected
    .slice(0, 10)
    .map((item) => `- ${item.title || "(no title)"} — ${item.url}`)
    .join("\n")

  return {
    task: "discover",
    system: GAP_SYSTEM,
    user: renderPrompt(template, {
      accepted: accepted || "(none)",
      rejected: rejected || "(none)",
      queries: input.queries.slice(-12).join("\n") || "(none)",
    }),
    temperature: 0,
    maxOutputTokens: 512,
  }
}

// ---------------------------------------------------------------------------
// Budgets and the loop
// ---------------------------------------------------------------------------

export interface DiscoveryBudgets {
  maxRounds: number
  maxQueriesPerRound: number
  maxQueriesPerRun: number
  urlsPerQuery: number
  maxFetchesPerRun: number
  maxFetchesPerRound: number
  pagesPerClassifyCall: number
  maxClassifyCalls: number
  maxGapCalls: number
  maxCandidatesPerRun: number
  maxPendingCandidates: number
  minTextLength: number
  fetchTimeoutMs: number
  fetchAttempts: number
  softDeadlineMs: number
  hardDeadlineMs: number
  maxIndexUrlsPerSource: number
  maxChildSitemaps: number
  maxSurfaceUrlsPerSource: number
}

export const DEFAULT_DISCOVERY_BUDGETS: DiscoveryBudgets = {
  maxRounds: 3,
  maxQueriesPerRound: 6,
  maxQueriesPerRun: 18,
  urlsPerQuery: 8,
  maxFetchesPerRun: 40,
  maxFetchesPerRound: 20,
  pagesPerClassifyCall: 10,
  maxClassifyCalls: 30,
  maxGapCalls: 2,
  maxCandidatesPerRun: 10,
  maxPendingCandidates: 50,
  minTextLength: 400,
  fetchTimeoutMs: 15_000,
  fetchAttempts: 3,
  softDeadlineMs: 35 * 60_000,
  hardDeadlineMs: 40 * 60_000,
  maxIndexUrlsPerSource: 3,
  maxChildSitemaps: 5,
  maxSurfaceUrlsPerSource: 500,
}

export type DiscoveryStopReason =
  | "round-cap"
  | "deadline"
  | "no-new-urls"
  | "no-signal"
  | "call-cap"
  | "fetch-cap"
  | "candidate-cap"
  | "query-cap"
  | "no-provider"
  | "none"

export interface DiscoveryRoundReport {
  round: number
  queries: string[]
  fetched: number
  accepted: number
  gaps: string[]
  stopReason: DiscoveryStopReason | null
}

export interface DiscoveryResult {
  rounds: DiscoveryRoundReport[]
  accepted: Candidate[]
  fetched: number
  queries: string[]
  errors: string[]
  stopReason: DiscoveryStopReason
}

export interface DiscoveryOptions {
  config: PipelineConfig
  router: Router
  store: StateStore
  sources: SourceConfig[]
  now: Date
  fetchImpl?: FetchLike
  budgets?: Partial<DiscoveryBudgets>
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

interface SurfaceUrl {
  url: string
  via: DiscoveredVia
  lastmod: string | null
}

interface FrontierCandidate extends SurfaceUrl {
  host: string
  score: number
  sourceId: string
  foundByQuery: string
}

function discoveryOf(state: PipelineState): DiscoveryState {
  return state.discovery ?? emptyDiscovery()
}

function withDiscovery(state: PipelineState, discovery: DiscoveryState): PipelineState {
  return { ...state, discovery }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostReady(discovery: DiscoveryState, host: string, now: Date): boolean {
  const health = discovery.hostHealth[host]
  if (!health || health.nextEligibleAt === null) return true
  return Date.parse(health.nextEligibleAt) <= now.getTime()
}

function recordHostFailure(
  discovery: DiscoveryState,
  host: string,
  now: Date,
): DiscoveryState {
  const previous: DiscoveryHostHealth = discovery.hostHealth[host] ?? {
    lastFetchedAt: null,
    failures: 0,
    nextEligibleAt: null,
  }
  const failures = previous.failures + 1
  const backoffMinutes = Math.min(24 * 60, 15 * 2 ** failures)

  return {
    ...discovery,
    hostHealth: {
      ...discovery.hostHealth,
      [host]: {
        lastFetchedAt: now.toISOString(),
        failures,
        nextEligibleAt: new Date(now.getTime() + backoffMinutes * 60_000).toISOString(),
      },
    },
  }
}

function resetHostHealth(
  discovery: DiscoveryState,
  host: string,
  now: Date,
): DiscoveryState {
  return {
    ...discovery,
    hostHealth: {
      ...discovery.hostHealth,
      [host]: { lastFetchedAt: now.toISOString(), failures: 0, nextEligibleAt: null },
    },
  }
}

function markSeen(
  discovery: DiscoveryState,
  url: string,
  status: number | null,
  contentHash: string | null,
  at: string,
): DiscoveryState {
  return {
    ...discovery,
    seenUrls: {
      ...discovery.seenUrls,
      [normalizeUrl(url)]: {
        firstSeenAt: at,
        status,
        ...(contentHash === null ? {} : { contentHash }),
      },
    },
  }
}

function queryTerms(text: string): string[] {
  const stop = new Set([
    "scholarship",
    "scholarships",
    "the",
    "and",
    "for",
    "with",
    "from",
    "official",
    "funding",
  ])
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !stop.has(term))
    .slice(0, 6)
}

function seedQueries(sources: SourceConfig[]): string[] {
  const out: string[] = []
  for (const source of sources) {
    out.push(`${source.provider} scholarship`)
    for (const host of source.officialHosts) out.push(`${host} scholarships`)
  }

  const seen = new Set<string>()
  return out.filter((query) => {
    const key = query.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceOrigin(source: SourceConfig): string {
  const first = source.indexUrls[0] ?? source.pageUrls[0]
  if (first) {
    try {
      return new URL(first).origin
    } catch {
      // fall through to the declared host
    }
  }
  return `https://${source.officialHosts[0]}`
}

interface SurfaceContext {
  config: PipelineConfig
  fetchImpl: FetchLike
  budgets: DiscoveryBudgets
  sleep: (ms: number) => Promise<void>
  random: () => number
  now: Date
}

async function fetchSurface(
  url: string,
  context: SurfaceContext,
  state: PipelineState,
): Promise<{
  snapshot: PageSnapshot | null
  state: PipelineState
  error: string | null
  status: number | null
}> {
  const host = hostOf(url)
  if (!host) return { snapshot: null, state, error: `Invalid URL: ${url}`, status: null }

  const discovery = discoveryOf(state)
  if (!hostReady(discovery, host, context.now)) {
    return { snapshot: null, state, error: null, status: null }
  }

  let allowed = false
  try {
    allowed = await robotsAllows(url, {
      fetchImpl: context.fetchImpl,
      userAgent: context.config.userAgent,
      timeoutMs: context.budgets.fetchTimeoutMs,
    })
  } catch {
    allowed = false
  }
  if (!allowed) {
    return {
      snapshot: null,
      state,
      error: `${url}: robots.txt disallows this URL`,
      status: null,
    }
  }

  try {
    const snapshot = await fetchText(url, {
      fetchImpl: context.fetchImpl,
      timeoutMs: context.budgets.fetchTimeoutMs,
      maxAttempts: context.budgets.fetchAttempts,
      userAgent: context.config.userAgent,
      sleep: context.sleep,
      random: context.random,
    })
    return {
      snapshot,
      state: withDiscovery(state, resetHostHealth(discovery, host, context.now)),
      error: null,
      status: snapshot.status,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = err instanceof FetchError ? err.status : null
    // A missing page is a dead lead, not a sick host. Network errors, auth
    // blocks, rate limits, and 5xx responses are host-level problems.
    const hostProblem =
      status === null || status === 403 || status === 429 || status >= 500
    const nextDiscovery = hostProblem
      ? recordHostFailure(discovery, host, context.now)
      : discovery
    return {
      snapshot: null,
      state: withDiscovery(state, nextDiscovery),
      error: `${url}: ${message}`,
      status,
    }
  }
}

async function collectSourceSurface(
  source: SourceConfig,
  context: SurfaceContext,
  state: PipelineState,
): Promise<{ urls: SurfaceUrl[]; state: PipelineState; errors: string[] }> {
  const urls = new Map<string, SurfaceUrl>()
  const errors: string[] = []

  const note = (
    result: { error: string | null; status: number | null },
    optional: boolean,
  ): void => {
    if (!result.error) return
    // A missing optional surface (robots, sitemap, feed) is normal. Only
    // report it when it signals blocking or a server fault.
    if (
      optional &&
      result.status !== null &&
      result.status < 500 &&
      result.status !== 403 &&
      result.status !== 429
    ) {
      return
    }
    errors.push(result.error)
  }

  const add = (url: string, via: DiscoveredVia, lastmod: string | null = null): void => {
    if (!isDiscoveryUrl(url, source.officialHosts)) return
    urls.set(normalizeUrl(url), { url, via, lastmod })
  }

  const origin = sourceOrigin(source)
  const sitemaps = new Set<string>([`${origin}/sitemap.xml`])

  const robots = await fetchSurface(`${origin}/robots.txt`, context, state)
  state = robots.state
  note(robots, true)
  if (robots.snapshot) {
    for (const match of robots.snapshot.text.matchAll(/^sitemap:\s*(\S+)/gim)) {
      const url = absoluteHttpUrl(match[1] ?? "", origin)
      if (url) sitemaps.add(url)
    }
  }

  for (const indexUrl of source.indexUrls.slice(0, context.budgets.maxIndexUrlsPerSource)) {
    const index = await fetchSurface(indexUrl, context, state)
    state = index.state
    note(index, false)
    if (!index.snapshot) continue

    const html = index.snapshot.html ?? ""
    for (const link of extractLinks(html, index.snapshot.finalUrl)) add(link, "index")

    for (const feed of extractFeedAlternates(html, index.snapshot.finalUrl).slice(0, 2)) {
      const snapshot = await fetchSurface(feed, context, state)
      state = snapshot.state
      note(snapshot, true)
      if (!snapshot.snapshot) continue
      for (const link of extractFeedLinks(snapshot.snapshot.text, snapshot.snapshot.finalUrl)) {
        add(link, "rss")
      }
    }
  }

  const queue = [...sitemaps]
  const seenSitemaps = new Set<string>()
  let fetchedSitemaps = 0

  while (queue.length > 0 && fetchedSitemaps <= context.budgets.maxChildSitemaps) {
    const sitemapUrl = queue.shift()!
    if (seenSitemaps.has(sitemapUrl)) continue
    seenSitemaps.add(sitemapUrl)

    const sitemap = await fetchSurface(sitemapUrl, context, state)
    state = sitemap.state
    note(sitemap, true)
    if (!sitemap.snapshot) continue
    fetchedSitemaps += 1

    const parsed = parseSitemap(sitemap.snapshot.text, sitemap.snapshot.finalUrl, source.officialHosts)
    for (const entry of parsed.entries) add(entry.url, "sitemap", entry.lastmod)
    for (const child of parsed.sitemaps) queue.push(child)
  }

  return {
    urls: [...urls.values()].slice(0, context.budgets.maxSurfaceUrlsPerSource),
    state,
    errors,
  }
}

interface PageMeta {
  source: SourceConfig
  via: DiscoveredVia
  foundByQuery: string
  score: number
}

function candidateIdFor(
  title: string,
  deadline: string | null,
  discoveredAt: string,
  existing: Set<string>,
): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "candidate"
  const year = deadline?.slice(0, 4) ?? discoveredAt.slice(0, 4)
  let id = `${base}-${year}`
  let suffix = 2
  while (existing.has(id)) {
    id = `${base}-${year}-${suffix}`
    suffix += 1
  }
  return id
}

function candidateFromPage(
  draft: DiscoveredPage,
  page: PageSnapshot,
  meta: PageMeta,
  existing: Candidate[],
  today: string,
  now: Date,
): Candidate | null {
  if (!draft.isScholarship) return null

  const title = draft.title?.trim()
  const provider = draft.provider?.trim()
  if (!title || !provider) return null

  const officialUrl = page.finalUrl
  if (!isAllowedHost(officialUrl, meta.source.officialHosts)) return null

  const evidence: EvidenceFact[] = []
  for (const item of draft.evidence) {
    if (!quoteAppearsIn(item.quote, page.text)) continue
    evidence.push({ field: item.field, quote: item.quote, sourceUrl: officialUrl })
  }
  if (evidence.length === 0) return null

  const deadlineSupported =
    draft.deadline !== null &&
    evidence.some(
      (item) =>
        item.field === "deadline" &&
        quoteSupportsDate(item.quote, draft.deadline!) &&
        isPlausibleDeadline(draft.deadline!, today),
    )
  const deadline = deadlineSupported ? draft.deadline : null

  const applySupported =
    draft.applyUrl !== null &&
    evidence.some(
      (item) =>
        item.field === "applyUrl" && quoteAppearsIn(draft.applyUrl!, item.quote),
    ) &&
    isAllowedApplyUrl(draft.applyUrl, meta.source.officialHosts)
  const applyUrl = applySupported ? draft.applyUrl : null

  const ids = new Set(existing.map((item) => item.candidateId))
  return {
    candidateId: candidateIdFor(title, deadline, now.toISOString(), ids),
    title,
    provider,
    country: draft.country?.trim() || null,
    officialUrl,
    deadline,
    applyUrl,
    evidence,
    sourceId: meta.source.sourceId,
    discoveredAt: now.toISOString(),
    status: "pending-review",
    foundByQuery: meta.foundByQuery,
    discoveredVia: meta.via,
    firstSeenAt: now.toISOString(),
    discoveryScore: meta.score,
  }
}

/**
 * Run the bounded discovery loop. All writes are to the candidates queue and
 * the shared pipeline state; published programs are never touched.
 */
export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { config, router, store, sources, now } = options
  const budgets: DiscoveryBudgets = { ...DEFAULT_DISCOVERY_BUDGETS, ...options.budgets }
  const fetchImpl = options.fetchImpl ?? fetch
  const clock = options.clock ?? (() => Date.now())
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random
  const startedMs = clock()
  const softDeadlineAt = startedMs + budgets.softDeadlineMs
  const hardDeadlineAt = startedMs + budgets.hardDeadlineMs
  const today = todayInPakistan(now)
  const discoverySources = sources.filter((source) => source.discovery && !source.archived)

  const result: DiscoveryResult = {
    rounds: [],
    accepted: [],
    fetched: 0,
    queries: [],
    errors: [],
    stopReason: "none",
  }

  if (discoverySources.length === 0) return result

  if (router.available("discover").length === 0) {
    result.stopReason = "no-provider"
    result.errors.push("No provider is available for discovery")
    return result
  }

  let existing = loadCandidates(config.candidatesPath)
  let state = store.get()
  let discovery = discoveryOf(state)

  const knownQueries = new Set(discovery.queries.map((query) => query.text.toLowerCase()))
  const seeds: DiscoveryQuery[] = seedQueries(discoverySources)
    .filter((text) => !knownQueries.has(text.toLowerCase()))
    .map((text, index) => ({
      id: `seed-${index + 1}`,
      text,
      round: 1,
      origin: "seed",
      createdAt: now.toISOString(),
    }))
  if (seeds.length > 0) {
    discovery = { ...discovery, queries: [...discovery.queries, ...seeds] }
    state = withDiscovery(state, discovery)
    store.set(state)
  }

  const context: SurfaceContext = {
    config,
    fetchImpl,
    budgets,
    sleep,
    random,
    now,
  }

  const surfaces = new Map<string, SurfaceUrl[]>()
  for (const source of discoverySources) {
    if (clock() >= hardDeadlineAt) {
      result.stopReason = "deadline"
      break
    }
    const collected = await collectSourceSurface(source, context, state)
    state = collected.state
    store.set(state)
    surfaces.set(source.sourceId, collected.urls)
    result.errors.push(...collected.errors)
  }
  discovery = discoveryOf(state)

  let queriesUsed = 0
  let classifyCalls = 0
  let gapCalls = 0
  let stopReason: DiscoveryStopReason | null = null

  for (let round = 1; round <= budgets.maxRounds; round += 1) {
    if (clock() >= softDeadlineAt) {
      stopReason = "deadline"
      break
    }
    discovery = discoveryOf(state)

    const roundQueries = discovery.queries
      .filter((query) => query.round === round)
      .map((query) => query.text)
      .slice(0, budgets.maxQueriesPerRound)
    if (roundQueries.length === 0) {
      stopReason = "no-signal"
      break
    }

    const frontier = new Map<string, FrontierCandidate>()
    for (const query of roundQueries) {
      if (queriesUsed >= budgets.maxQueriesPerRun) {
        stopReason = "query-cap"
        break
      }
      queriesUsed += 1
      const terms = queryTerms(query)

      for (const [sourceId, urls] of surfaces) {
        const source = discoverySources.find((item) => item.sourceId === sourceId)
        if (!source) continue

        const scored = urls
          .filter((item) => isDiscoveryUrl(item.url, source.officialHosts))
          .map((item) => ({
            ...item,
            host: hostOf(item.url) ?? "",
            score: scoreFrontier({
              url: item.url,
              host: hostOf(item.url) ?? "",
              allowedHosts: source.officialHosts,
              discoveredVia: item.via,
              lastmod: item.lastmod,
              queryTerms: terms,
              now,
            }),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, budgets.urlsPerQuery)

        for (const item of scored) {
          const key = normalizeUrl(item.url)
          if (discovery.seenUrls[key]) continue
          if (existing.some((candidate) => normalizeUrl(candidate.officialUrl) === key)) continue

          const previous = frontier.get(key)
          if (!previous || item.score > previous.score) {
            frontier.set(key, {
              url: item.url,
              via: item.via,
              lastmod: item.lastmod,
              host: item.host,
              score: item.score,
              sourceId,
              foundByQuery: query,
            })
          }
        }
      }
    }

    if (stopReason === "query-cap") {
      result.rounds.push({
        round,
        queries: roundQueries,
        fetched: 0,
        accepted: 0,
        gaps: [],
        stopReason,
      })
      break
    }

    if (frontier.size === 0) {
      stopReason = "no-new-urls"
      result.rounds.push({
        round,
        queries: roundQueries,
        fetched: 0,
        accepted: 0,
        gaps: [],
        stopReason,
      })
      break
    }

    const remainingFetches = budgets.maxFetchesPerRun - result.fetched
    if (remainingFetches <= 0) {
      stopReason = "fetch-cap"
      break
    }

    const shortlist = [...frontier.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(budgets.maxFetchesPerRound, remainingFetches))

    const fetchedBefore = result.fetched
    const pages: { page: PageSnapshot; meta: PageMeta }[] = []
    let lastHost = ""

    for (const item of shortlist) {
      if (clock() >= hardDeadlineAt) {
        stopReason = "deadline"
        break
      }

      const host = item.host
      if (!host) continue
      if (!hostReady(discovery, host, now)) continue

      if (lastHost === host) await sleep(1_000)
      lastHost = host

      const source = discoverySources.find((entry) => entry.sourceId === item.sourceId)
      if (!source) continue

      const fetched = await fetchSurface(item.url, context, state)
      state = fetched.state
      discovery = discoveryOf(state)
      result.fetched += 1

      if (fetched.snapshot) {
        discovery = markSeen(
          discovery,
          item.url,
          fetched.snapshot.status,
          fetched.snapshot.hash,
          now.toISOString(),
        )
        if (fetched.snapshot.text.length >= budgets.minTextLength) {
          pages.push({
            page: fetched.snapshot,
            meta: {
              source,
              via: item.via,
              foundByQuery: item.foundByQuery,
              score: item.score,
            },
          })
        }
      } else {
        discovery = markSeen(discovery, item.url, null, null, now.toISOString())
        if (fetched.error) result.errors.push(fetched.error)
      }

      state = withDiscovery(state, discovery)
      store.set(state)
    }

    const fetchedThisRound = result.fetched - fetchedBefore
    const rejected: { url: string; title: string }[] = []
    let acceptedThisRound = 0
    let gaps: string[] = []

    for (let index = 0; index < pages.length; index += budgets.pagesPerClassifyCall) {
      if (result.accepted.length >= budgets.maxCandidatesPerRun) {
        stopReason = "candidate-cap"
        break
      }
      if (classifyCalls >= budgets.maxClassifyCalls) {
        stopReason = "call-cap"
        break
      }
      if (clock() >= hardDeadlineAt) {
        stopReason = "deadline"
        break
      }

      const batch = pages.slice(index, index + budgets.pagesPerClassifyCall)
      try {
        const response = await router.complete(
          buildDiscoverRequest(batch.map((entry) => entry.page), config.promptsDir),
        )
        classifyCalls += 1

        const drafts = parseDiscoveryResponse(response.text)
        const byUrl = new Map(batch.map((entry) => [normalizeUrl(entry.page.finalUrl), entry]))
        const accepted: Candidate[] = []

        for (const draft of drafts) {
          const entry = byUrl.get(normalizeUrl(draft.url))
          if (!entry) continue

          const candidate = candidateFromPage(
            draft,
            entry.page,
            entry.meta,
            existing,
            today,
            now,
          )
          if (candidate) {
            accepted.push(candidate)
          } else {
            rejected.push({ url: entry.page.finalUrl, title: pageTitle(entry.page.html) })
          }
        }

        const remainingCandidates = budgets.maxCandidatesPerRun - result.accepted.length
        const limited = accepted.slice(0, Math.max(0, remainingCandidates))
        if (limited.length > 0) {
          const before = existing.length
          existing = mergeCandidates(existing, limited, budgets.maxPendingCandidates)
          const added = existing.slice(before)
          if (added.length > 0) {
            saveCandidates(config.candidatesPath, existing)
            result.accepted.push(...added)
            acceptedThisRound += added.length
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`Discovery classification failed: ${message}`)
      }
    }

    if (result.accepted.length >= budgets.maxCandidatesPerRun) {
      stopReason = "candidate-cap"
    }

    if (
      stopReason === null &&
      round < budgets.maxRounds &&
      gapCalls < budgets.maxGapCalls &&
      rejected.length > 0 &&
      clock() < softDeadlineAt
    ) {
      try {
        const response = await router.complete(
          buildGapRequest(
            {
              accepted: result.accepted,
              rejected,
              queries: discovery.queries.map((query) => query.text),
            },
            config.promptsDir,
          ),
        )
        gapCalls += 1

        const known = new Set(discovery.queries.map((query) => query.text.toLowerCase()))
        const fresh = parseGapResponse(response.text)
          .filter((text) => !known.has(text.toLowerCase()))
          .map((text, index) => ({
            id: `gap-${round}-${index + 1}`,
            text,
            round: round + 1,
            origin: "gap" as const,
            createdAt: now.toISOString(),
          }))

        if (fresh.length > 0) {
          discovery = { ...discovery, queries: [...discovery.queries, ...fresh] }
          state = withDiscovery(state, discovery)
          store.set(state)
          gaps = fresh.map((query) => query.text)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`Gap analysis failed: ${message}`)
      }
    }

    result.rounds.push({
      round,
      queries: roundQueries,
      fetched: fetchedThisRound,
      accepted: acceptedThisRound,
      gaps,
      stopReason,
    })

    if (stopReason !== null) break
    if (result.fetched >= budgets.maxFetchesPerRun) {
      stopReason = "fetch-cap"
      break
    }
    if (gaps.length === 0) {
      stopReason = "no-signal"
      break
    }
  }

  result.queries = discovery.queries.map((query) => query.text)
  result.stopReason = stopReason ?? "round-cap"

  const lastRound = result.rounds[result.rounds.length - 1]
  if (lastRound && lastRound.stopReason === null) {
    lastRound.stopReason = result.stopReason
  }

  return result
}
