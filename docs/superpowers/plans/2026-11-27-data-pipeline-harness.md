# Data Pipeline & Agent Harness Implementation Plan

> **For agentic workers:** This plan is executed natively by the primary agent.
> `AGENTS.md` forbids coding subagents. Steps use checkbox (`- [ ]`) syntax for
> tracking. The durable record is this file plus one commit per task.

**Goal:** Make the site update itself daily from official scholarship pages:
fetch, extract, verify, checkpoint, publish, and report — at $0, with no server
and no autonomous publication of unverified facts.

**Architecture:** A resumable TypeScript pipeline runs in GitHub Actions. It
fetches official pages, hashes them, asks a quota-aware router of free models
for schema-validated facts with evidence quotes, checks those facts
deterministically and with a second model, then merges verified values into
`src/data/programs/*.json`. New programs are only queued in
`pipeline/candidates.json` for the Plan 3 admin review; known programs update
automatically. State is committed so a quota pause resumes exactly where it
stopped. Extraction is text-based, so there are no selectors to learn; page
hashes, source health, and run history are the agent's memory.

**Tech Stack:** Node 24, TypeScript strict, zod, `tsx`, `node-html-parser`,
`unpdf`, native `fetch`, Vitest, GitHub Actions, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-11-26-scholarship-tracker-design.md`
(sections 7–9b). Trust rules: `AGENTS.md`.

## Global Constraints

- $0 running cost. No paid API tier, database, server, or proxy service.
- Every published fact carries an evidence quote from an official page or PDF.
- A deadline is published as a date only when its verification is `verified`.
- Apply is published only for a verified, non-closed cycle with a real HTTPS URL.
- New programs are never auto-published; they go to `pipeline/candidates.json`.
- Program identity, eligibility, and funding stay frozen in Plan 2. Only cycles,
  dates, apply links, sources, evidence, and guides may change.
- Keep `src/data/run-status.json` at `sample` until a real successful run; unit
  and e2e tests must never flip it. A run that checks every active source and
  publishes no changes is still successful and refreshes `lastSuccessfulRun`.
- No secrets in the repo. Keys live in GitHub Secrets or the local environment.
- Every network call has a timeout; robots.txt is respected; no personal data.
- Prompts are versioned files; extraction runs at temperature 0.
- At most 180 AI calls per day; checkpoint after every item.
- A source with five consecutive fetch failures is retired from future runs
  until a human re-enables it; a short or shrunken page is suspicious, not a
  reason to publish.
- Data writes are atomic (temp file + rename) and zod-validated.
- Keep `programId` stable and every existing cycle; never overwrite history.
- Node 24; TypeScript strict; no `any` in exported interfaces.

## Review Focus

1. **A page that loads but yields no usable facts** (JS shell, bot block, layout
   change). Expected: keep the last good data, mark the source unhealthy, never
   publish an empty or half-filled listing.
2. **A plausible fact the source does not support** (date absent from the quote,
   apply URL on a lookalike domain). Expected: deterministic checks reject it;
   the fact stays provisional and no Apply button appears.
3. **Quota exhaustion or cancellation mid-run.** Expected: state saved, run
   paused, next run resumes without duplicate cycles or repeated work.
4. **A deadline passes while the pipeline is paused.** Expected: status is
   derived on the next publish; the freshness banner covers data older than 36h;
   a closed cycle never shows Apply.
5. **A discovered scholarship with partial facts.** Expected: queued for review,
   never published as a listing with invented eligibility or funding.

## File Structure

```
scripts/pipeline/
  main.ts            CLI: args, env, providers, run, step summary, exit code
  eval.ts            golden-fixture eval (recorded model outputs)
  config.ts          paths, provider settings, routing, limits
  types.ts           shared interfaces and zod schemas
  sources.ts         source registry load/validate
  state.ts           checkpoint load/save, item keys, provider usage
  fetch.ts           HTTP with retries, backoff, robots, hashing
  html.ts            HTML -> text and links
  pdf.ts             PDF bytes -> text
  text.ts            text normalization, quote presence, URL normalization
  prompts.ts         prompt file loading/rendering
  extract.ts         extraction prompt, schema, parse, validate
  dates.ts           quote -> date support and plausibility checks
  urls.ts            apply URL host/redirect checks
  verify.ts          second-model cross-check and status decision
  publish.ts         merge extraction into a program, derive status, write
  run.ts             orchestrator: queue, pause/resume, per-item checkpoint
  report.ts          run report JSON + GitHub step summary
  discover.ts        index link discovery -> candidate queue
  providers/
    gemini.ts groq.ts cloudflare.ts openrouter.ts
  router.ts          quota-aware routing, cooldowns, daily cap
pipeline/
  sources.json       source registry (committed)
  candidates.json    discovery queue (committed)
  state.json         checkpoint (generated, committed by the workflow)
  runs/              run reports (generated, committed)
  prompts/           extract.md, verify.md, discover.md
  fixtures/          HTML pages + recorded model outputs for eval
```

---

### Task 1: Cycle status invariant and seed normalization

**Files:**
- Create: `src/lib/cycle-status.ts`
- Modify: `src/data/programs/commonwealth-pakistan-2025.json`
- Modify: `src/data/programs/erasmus-mundus-joint-masters.json`
- Modify: `src/data/programs/chevening-pakistan.json`,
  `daad-epos.json`, `fulbright-pakistan.json`, `hec-need-based.json`,
  `sindh-endowment-fund.json`, `sindh-matric-scholarship.json`,
  `turkiye-burslari.json` (status only)
- Modify: `tests/unit/data.test.ts`, `tests/unit/eligibility.test.ts`
- Test: `tests/unit/cycle-status.test.ts`

**Interfaces:**
- Produces: `todayInPakistan(now: Date): string` and
  `deriveCycleStatus(dates: { opens: string | null; deadline: string | null }, today: string): 'open' | 'upcoming' | 'closed' | null`.
  The pipeline imports both in Task 7.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/cycle-status.test.ts
import { expect, test } from 'vitest'
import { deriveCycleStatus, todayInPakistan } from '../../src/lib/cycle-status'

test('closed when the deadline has passed', () => {
  expect(deriveCycleStatus({ opens: '2026-01-01', deadline: '2026-11-26' }, '2026-11-27')).toBe('closed')
})
test('open on the deadline day', () => {
  expect(deriveCycleStatus({ opens: '2026-01-01', deadline: '2026-11-27' }, '2026-11-27')).toBe('open')
})
test('upcoming before applications open', () => {
  expect(deriveCycleStatus({ opens: '2027-08-01', deadline: '2027-11-03' }, '2026-11-27')).toBe('upcoming')
})
test('open when applications are open', () => {
  expect(deriveCycleStatus({ opens: '2026-11-01', deadline: '2027-01-15' }, '2026-11-27')).toBe('open')
})
test('open when opens is unknown but a future deadline exists', () => {
  expect(deriveCycleStatus({ opens: null, deadline: '2027-01-15' }, '2026-11-27')).toBe('open')
})
test('null when both dates are missing', () => {
  expect(deriveCycleStatus({ opens: null, deadline: null }, '2026-11-27')).toBeNull()
})
test('todayInPakistan crosses midnight in UTC', () => {
  expect(todayInPakistan(new Date('2026-11-27T20:00:00Z'))).toBe('2026-11-28')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/cycle-status.test.ts`
Expected: FAIL — module `src/lib/cycle-status.ts` not found.

- [ ] **Step 3: Implement the module**

Use `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric',
month: '2-digit', day: '2-digit' })` for `todayInPakistan` (returns
`YYYY-MM-DD`). Rules, in order: `deadline < today` → closed; `opens > today` →
upcoming; `opens !== null` → open; `deadline !== null` → open; otherwise null.

- [ ] **Step 4: Normalize the seed data**

- `commonwealth-pakistan-2025`, cycle `2027`: opens `2026-05-04`, deadline
  `2026-06-30`, resultsDate `2026-11-15`, studyStart `2027-09-01`, status
  `closed`. Keep `cycleId: "2027"` and the label.
- `erasmus-mundus-joint-masters`, cycle `2027`: opens `2026-01-15`, deadline
  `2026-03-31`, resultsDate `2026-06-15`, studyStart `2027-09-01`, status
  `closed`. Keep `cycleId: "2027"`.
- Set every other non-archived cycle's status to
  `deriveCycleStatus(dates, '2026-11-27')`. Expected: Chevening, DAAD, Erasmus
  `2028`, Fulbright, HEC, both Sindh programs, and Türkiye become `upcoming`.
- Set `lastUpdated` to `2026-11-27T00:00:00.000Z` on every program whose status
  or dates changed. Keep `firstSeen` unchanged.

- [ ] **Step 5: Update dependent tests**

- `tests/unit/data.test.ts`: expect Erasmus `nextCycle(program)!.status` to be
  `'upcoming'`. Add a test that every cycle's status equals
  `deriveCycleStatus(cycle.dates, '2026-11-27')` (skip `archived`).
- `tests/unit/eligibility.test.ts`: select the Chevening cycle with
  `nextCycle(chevening)!` instead of `find(c => c.status === 'open')`. The
  "closed" test keeps cloning the cycle with `status: 'closed'`.

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cycle-status.ts src/data/programs tests/unit
git commit -m "fix: derive cycle status from dates and normalize seed data"
```

---

### Task 2: Pipeline registry, config, and checkpoint state

**Files:**
- Create: `scripts/pipeline/types.ts`, `config.ts`, `sources.ts`, `state.ts`
- Create: `pipeline/sources.json`
- Modify: `src/lib/data.ts` (add `loadProgramsFrom(dir)`)
- Modify: `package.json` (add `tsx`)
- Modify: `tsconfig.json` (include `scripts/**/*.ts`)
- Test: `tests/unit/pipeline-sources.test.ts`, `pipeline-state.test.ts`,
  `pipeline-config.test.ts`

**Interfaces:**
- Produces: every shared type in `types.ts` used by later tasks:
  `AiTask`, `ProviderId`, `RunStatus`, `ItemState`, `SourceConfig`,
  `PageSnapshot`, `EvidenceFact`, `ExtractedCycle`, `Extraction`, `AiRequest`,
  `AiResponse`, `Router`, `PipelineState`, `RunReport`, `Candidate`,
  `ProviderSettings`, `PipelineConfig`.
- Produces: `loadConfig(env, root?): PipelineConfig`;
  `loadSources(path): SourceConfig[]`;
  `loadState(path): PipelineState`; `saveState(path, state): void`;
  `itemKey(sourceId, url): string`;
  `startOrResumeRun(state, runId, startedAt): PipelineState`;
  `updateItem(state, key, patch): PipelineState`;
  `recordProviderCall(state, providerId, day): PipelineState`;
  `setProviderCooldown(state, providerId, until): PipelineState`;
  `providerReady(state, providerId, now): boolean`;
  `callsOn(state, day): number`;
  `loadProgramsFrom(dir): Program[]`.

- [ ] **Step 1: Write the failing tests**

`pipeline-sources.test.ts`:
- a valid registry loads one source;
- duplicate `sourceId` throws;
- a non-HTTPS `pageUrl` throws;
- an empty `officialHosts` array throws;
- an unknown field throws.

`pipeline-state.test.ts`:
- a missing file returns an empty state;
- `saveState` round-trips and leaves no `.tmp` file;
- invalid JSON or a wrong version throws instead of resetting;
- `startOrResumeRun` keeps a `paused` run and replaces a `complete` run;
- `updateItem` changes only the target item;
- `recordProviderCall` increments only the matching day;
- `providerReady` is false inside a cooldown and true after it.

`pipeline-config.test.ts`:
- no keys → `providers` is empty;
- `GEMINI_API_KEY` → only Gemini configured, model `gemini-2.5-flash`;
- `GEMINI_MODEL` overrides the model;
- all paths resolve under the given root;
- defaults are `dailyCallLimit: 180`, `maxAttempts: 3`,
  `requestTimeoutMs: 60000`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-sources.test.ts tests/unit/pipeline-state.test.ts tests/unit/pipeline-config.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add dependencies and implement the modules**

Run: `npm install -D tsx`. The `pipeline` npm script lands in Task 8, when
`main.ts` exists.

`types.ts` defines the interfaces. Key shapes:

```ts
export type AiTask = 'extract' | 'extract-long' | 'verify' | 'discover'
export type ProviderId = 'gemini' | 'groq' | 'cloudflare' | 'openrouter'
export type RunStatus = 'running' | 'paused' | 'complete' | 'failed'
export type ItemState = 'pending' | 'fetched' | 'extracted' | 'verified' | 'published' | 'failed' | 'dead'

export interface SourceConfig {
  sourceId: string
  programId: string | null
  provider: string
  officialHosts: string[]
  pageUrls: string[]
  indexUrls: string[]
  discovery: boolean
  archived: boolean
}

export interface EvidenceFact {
  field: string
  quote: string
  sourceUrl: string
}

export interface ExtractedCycle {
  label: string
  dates: { opens: string | null; deadline: string | null; resultsDate: string | null; studyStart: string | null }
  apply: { url: string | null; portalName: string | null; fee: string | null }
  evidence: EvidenceFact[]
}

export interface Extraction {
  pageKind: 'program' | 'index' | 'unknown'
  cycles: ExtractedCycle[]
  guide: { steps: string[]; documents: string[]; tips: string[]; timeline: string[] } | null
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
}

export interface Router {
  complete(request: AiRequest, options?: { exclude?: ProviderId[] }): Promise<AiResponse>
  available(task: AiTask, exclude?: ProviderId[]): ProviderId[]
}
```

`PipelineState` holds `version: 1`, `run: RunCheckpoint | null`,
`pages: Record<string, { hash: string; textLength: number; lastFetchedAt: string; failures: number }>`
keyed by `itemKey(sourceId, url)` so two programs sharing one URL still each
extract it,
`sources: Record<string, { lastFetchedAt: string | null; failures: number; retired: boolean; nextEligibleAt: string | null }>`,
`providers: Record<string, { callsByDay: Record<string, number>; cooldownUntil: string | null; lastError: string | null }>`,
and `lastSuccessfulRun: string | null`. Candidates live only in
`pipeline/candidates.json`, not in state.
`RunCheckpoint` holds `runId`, `startedAt`, `status`, and
`items: Record<string, { state: ItemState; attempts: number; hash: string | null; lastError: string | null; updatedAt: string }>`.

`PipelineConfig` holds `dataDir`, `statePath`, `registryPath`, `candidatesPath`,
`runStatusPath`, `reportsDir`, `promptsDir`, `providers:
Partial<Record<ProviderId, ProviderSettings>>`, `routing:
Record<AiTask, ProviderId[]>`, `dailyCallLimit`, `maxAttempts`,
`requestTimeoutMs`, and `userAgent`. `ProviderSettings` is
`{ apiKey: string; model: string; accountId?: string }`.

`config.ts` paths are relative to `root` (default `process.cwd()`). Providers
read `GEMINI_API_KEY`, `GROQ_API_KEY`, `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_MODEL`, `OPENROUTER_API_KEY` +
`OPENROUTER_MODEL`. Default routing: extract `['groq','gemini']`,
extract-long `['gemini','groq']`, verify `['gemini','groq']`, discover
`['groq','gemini']`.

`state.ts` validates with zod, throws `StateError` on corruption, and writes
with `mkdirSync(dirname, { recursive: true })`, `writeFileSync(tmp)`,
`renameSync(tmp, path)`.

`sources.ts` validates with zod, throws on duplicate `sourceId`, and rejects a
`pageUrl` that is not HTTPS.

`src/lib/data.ts`: extract the body of `loadPrograms()` into
`loadProgramsFrom(dir: string)`; `loadPrograms()` calls it with `PROGRAMS_DIR`.

- [ ] **Step 4: Seed `pipeline/sources.json`**

One entry per seed program. Use these official URLs and hosts; `discovery` is
true for programs whose pages link to scholarship sub-pages:

| sourceId | programId | pageUrls | officialHosts |
|---|---|---|---|
| chevening | chevening-pakistan | `https://www.chevening.org/scholarships/` | `chevening.org` |
| fulbright | fulbright-pakistan | `https://www.usefp.org/` | `usefp.org` |
| daad | daad-epos | `https://www.daad.de/en/` | `daad.de` |
| erasmus | erasmus-mundus-joint-masters | `https://eacea.ec.europa.eu/` | `eacea.ec.europa.eu`, `ec.europa.eu` |
| hec | hec-need-based | `https://www.hec.gov.pk/english/Pages/default.aspx` | `hec.gov.pk` |
| sindh-endowment | sindh-endowment-fund | `https://www.sindh.gov.pk/` | `sindh.gov.pk` |
| sindh-matric | sindh-matric-scholarship | `https://www.sindh.gov.pk/` | `sindh.gov.pk` |
| turkiye | turkiye-burslari | `https://www.turkiyeburslari.gov.tr/en` | `turkiyeburslari.gov.tr` |
| commonwealth | commonwealth-pakistan-2025 | `https://cscuk.fcdo.gov.uk/scholarships/` | `cscuk.fcdo.gov.uk` |

Set `indexUrls` equal to `pageUrls` for discovery sources. Set
`archived: true` for `commonwealth`, `discovery: false` for it, and
`programId: null` nowhere yet (discovery-only sources can be added later).

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline pipeline/sources.json src/lib/data.ts package.json package-lock.json tsconfig.json tests/unit
git commit -m "feat: add pipeline config, source registry, and checkpoint state"
```

---

### Task 3: Fetching, HTML text, links, and PDF text

**Files:**
- Create: `scripts/pipeline/fetch.ts`, `html.ts`, `pdf.ts`
- Modify: `package.json` (`node-html-parser`, `unpdf`)
- Test: `tests/unit/pipeline-fetch.test.ts`, `pipeline-content.test.ts`

**Interfaces:**
- Consumes: `PageSnapshot` from `types.ts`.
- Produces: `fetchText(url, options?): Promise<PageSnapshot>`;
  `fetchBytes(url, options?): Promise<Omit<PageSnapshot, 'text'> & { bytes: Uint8Array }>`;
  `robotsAllows(url, options?): Promise<boolean>`; `clearRobotsCache(): void`;
  `htmlToText(html: string): string`;
  `extractLinks(html: string, baseUrl: string): string[]`;
  `pdfToText(bytes: Uint8Array): Promise<string>`.

`PageSnapshot` is `{ url, finalUrl, status, contentType, hash, text }`.

- [ ] **Step 1: Write the failing tests**

`pipeline-fetch.test.ts`:
- a 200 response returns text, final URL, content type, and a stable SHA-256
  hash;
- a 503 then 200 retries and succeeds;
- a 404 does not retry and throws `FetchError` with `status: 404`;
- a 429 with `Retry-After: 1` waits and retries;
- a timeout aborts and throws;
- a PDF response is converted to text through `pdfToText` (mock the module);
- `robotsAllows` returns true when robots.txt is 404, false for a matching
  `Disallow: /private`, and true when `Allow` overrides it;
- two identical bodies produce the same hash; one changed character changes it.

`pipeline-content.test.ts`:
- `htmlToText` drops script/style/svg, keeps headings and list text, decodes
  entities, and collapses whitespace;
- `extractLinks` resolves relative links, drops fragments and duplicates, and
  keeps only http(s);
- `pdfToText` calls the `unpdf` extractor with merged pages (mock `unpdf` with
  `vi.mock`).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-fetch.test.ts tests/unit/pipeline-content.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Run: `npm install -D node-html-parser unpdf`.

`fetch.ts`: use native `fetch` with `AbortSignal.timeout(timeoutMs)`. User agent
`ScholarshipTrackerBot/1.0 (+https://github.com/abduljawad-ai/scholarship-tracker)`.
Retry network errors, 408, 425, 429, 500, 502, 503, 504; max 3 attempts; backoff
`min(8000, 500 * 2^attempt) + random * 250`; honor `Retry-After` seconds or an
HTTP date. Do not retry 401/403/404. `fetchText` reads `text/html`, `text/plain`, and
`application/xhtml+xml` directly; for `application/pdf` it reads bytes and calls
`pdfToText`; other content types throw. `fetchBytes` is for callers that need the
raw bytes. `robotsAllows` fetches `${origin}/robots.txt`, parses
groups for `*` and the bot name, and uses longest-match `Allow`/`Disallow`.
Cache robots results in a module-level `Map` per process; export
`clearRobotsCache()` so tests start clean.

`html.ts`: parse with `node-html-parser`; remove `script, style, noscript, svg,
template, iframe`; replace block elements with newlines; use `textContent`;
collapse `\s+` to a single space but keep paragraph breaks as `\n`.
`extractLinks`: `querySelectorAll('a[href]')`, resolve against `baseUrl`, strip
fragments, dedupe.

`pdf.ts`: `import { extractText } from 'unpdf'`; call
`extractText(bytes, { mergePages: true })`; return the text. Keep the import
inside the function so HTML-only runs do not load the PDF bundle.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/fetch.ts scripts/pipeline/html.ts scripts/pipeline/pdf.ts package.json package-lock.json tests/unit
git commit -m "feat: add fetching, robots checks, HTML text, and PDF extraction"
```

---

### Task 4: AI providers and the quota-aware router

**Files:**
- Create: `scripts/pipeline/providers/gemini.ts`, `groq.ts`, `cloudflare.ts`,
  `openrouter.ts`, `scripts/pipeline/router.ts`
- Test: `tests/unit/pipeline-providers.test.ts`, `pipeline-router.test.ts`

**Interfaces:**
- Consumes: `AiRequest`, `AiResponse`, `ProviderId`, `PipelineState`,
  `PipelineConfig` from Tasks 2.
- Produces: `createProvider(id, settings, fetchImpl?): Provider`;
  `createRouter(deps): Router`; `ProvidersExhaustedError`;
  `ProviderQuotaError`; `ProviderAuthError`; `ProviderRequestError`.
  `Provider` is `{ id: ProviderId; model: string; complete(request:
  AiRequest, signal: AbortSignal): Promise<string> }`.
  Router deps are `{ config: PipelineConfig; store: StateStore; fetchImpl?:
  FetchLike; now?: () => Date }`. `StateStore` is `{ get(): PipelineState;
  set(next: PipelineState): void }`; `createMemoryStore` and
  `createFileStore` live in `state.ts`. The store is shared with the
  orchestrator so item checkpoints and provider usage cannot clobber each
  other.

- [ ] **Step 1: Write the failing tests**

`pipeline-providers.test.ts`:
- Groq posts to `https://api.groq.com/openai/v1/chat/completions` with
  `response_format: { type: 'json_object' }` and parses
  `choices[0].message.content`;
- Gemini posts to the model endpoint with `responseMimeType:
  'application/json'` and parses `candidates[0].content.parts[0].text`;
- Cloudflare posts to the account AI endpoint and parses `result.response`;
- OpenRouter posts to `https://openrouter.ai/api/v1/chat/completions` with
  `HTTP-Referer` and `X-Title` headers;
- a 429 response throws `ProviderQuotaError` with a retry delay.

`pipeline-router.test.ts`:
- the first configured provider in the task order is used;
- a 429 cools that provider down and the next provider answers;
- `exclude` skips the primary provider (two-model verification);
- a provider over the daily cap is skipped;
- all providers cooling down throws `ProvidersExhaustedError`;
- a successful call increments the day's count and persists once.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-providers.test.ts tests/unit/pipeline-router.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the providers**

Each provider takes `(request, signal)` and returns the text. Use a shared
`postJson(url, body, headers, signal)` helper in `router.ts` or a private
`http.ts`; no new dependency. Detect quota by status 429 or a body containing
`RESOURCE_EXHAUSTED`, `quota`, or `rate limit`; parse `Retry-After` or a
`retryDelay` field; default cooldown 15 minutes. Detect auth by 401/403 and
throw `ProviderAuthError` (router disables that provider for 24h).

Default models: Gemini `gemini-2.5-flash`; Groq `openai/gpt-oss-120b`.
Cloudflare and OpenRouter require an explicit model in env; do not guess a
model ID.

- [ ] **Step 4: Implement the router**

`createRouter({ config, store, fetchImpl, now })` builds only the
configured providers. `complete` walks `config.routing[request.task]`, skips
excluded/cooling/over-cap providers, catches quota/auth errors (records cooldown
and persists), and returns the first success. On success,
`store.set(recordProviderCall(store.get(), id, todayInPakistan(now())))`.
`available(task, exclude)` returns the ready provider IDs without calling.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/providers scripts/pipeline/router.ts tests/unit
git commit -m "feat: add free-model providers and the quota-aware router"
```

---

### Task 5: Prompts, extraction schema, and validation

**Files:**
- Create: `pipeline/prompts/extract.md`
- Create: `scripts/pipeline/prompts.ts`, `text.ts`, `extract.ts`
- Test: `tests/unit/pipeline-extract.test.ts`, `pipeline-text.test.ts`

**Interfaces:**
- Consumes: `SourceConfig`, `PageSnapshot`, `Extraction`, `AiRequest`.
- Produces: `loadPrompt(name, dir): string`;
  `renderPrompt(template, vars): string`;
  `normalizeText(s): string`; `quoteAppearsIn(quote, sourceText): boolean`;
  `normalizeUrl(url): string`;
  `ExtractionSchema`; `buildExtractRequest(source, snapshot, promptsDir): AiRequest`;
  `parseExtraction(text): Extraction`;
  `validateExtraction(extraction, snapshot, source): string[]`.

- [ ] **Step 1: Write the failing tests**

- `renderPrompt` replaces every `{{var}}` and throws on a missing variable;
- `normalizeText` folds curly quotes and dashes to ASCII and collapses
  whitespace; `quoteAppearsIn` is true across line breaks and smart quotes;
- `normalizeUrl` lowercases the host and strips fragments and a trailing slash;
- `parseExtraction` accepts a JSON object, strips ```json fences, and throws
  `ExtractionParseError` on invalid JSON or a schema violation;
- `buildExtractRequest` chooses `extract-long` when the text exceeds 24,000
  characters and truncates to 60,000; otherwise `extract` and truncates to
  24,000;
- `validateExtraction` accepts a cycle whose deadline quote contains
  `3 November 2027`;
- it rejects a deadline with no `deadline` evidence;
- it rejects a quote that is not in the page text;
- it rejects an evidence `sourceUrl` that is not the page URL;
- it rejects a program page with zero cycles;
- it rejects a guide item with no matching `guide.steps`/`documents`/`tips`/
  `timeline` evidence.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-extract.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `extract.md`**

Rules: return JSON only; never infer; `null` when the page does not state a
value; ISO dates; quote the exact sentence for every non-null fact; use field
names `opens`, `deadline`, `resultsDate`, `studyStart`, `applyUrl`,
`guide.steps`, `guide.documents`, `guide.tips`, `guide.timeline`; one cycle per
intake; `pageKind` is `program`, `index`, or `unknown`. Include the JSON shape
and a worked example. No marketing language.

- [ ] **Step 4: Implement the schema and validation**

`ExtractionSchema` is a strict zod object matching `Extraction`. `parseExtraction`
finds the first `{` and last `}` after stripping fences.

`validateExtraction` checks:
- `pageKind === 'program'` and at least one cycle;
- every non-null date and apply URL has an evidence entry with the matching
  field;
- every evidence quote passes `quoteAppearsIn` from `text.ts` against the
  snapshot text;
- every evidence `sourceUrl` equals the snapshot final URL after
  `normalizeUrl`;
- every non-empty guide item has a matching `guide.*` evidence quote.

Return an array of human-readable errors; empty means valid.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add pipeline/prompts/extract.md scripts/pipeline/prompts.ts scripts/pipeline/text.ts scripts/pipeline/extract.ts tests/unit
git commit -m "feat: add versioned extraction prompt, schema, and validation"
```

---

### Task 6: Deterministic checks and two-model verification

**Files:**
- Create: `scripts/pipeline/dates.ts`, `urls.ts`, `verify.ts`
- Create: `pipeline/prompts/verify.md`
- Test: `tests/unit/pipeline-verify.test.ts`

**Interfaces:**
- Consumes: `Router`, `PageSnapshot`, `EvidenceFact`, `SourceConfig`;
  `normalizeText`, `quoteAppearsIn`, `normalizeUrl` from `text.ts`.
- Produces: `quoteSupportsDate(quote, isoDate): boolean`;
  `isPlausibleDeadline(isoDate, today): boolean`;
  `isAllowedHost(url, hosts): boolean`;
  `isAllowedApplyUrl(url, hosts): boolean`;
  `checkApplyUrl(url, hosts, fetchImpl?): Promise<{ ok: boolean; finalUrl: string | null; reason: string }>`;
  `VerifiableFact extends EvidenceFact { value: string }`;
  `buildVerifyRequest(fact, snapshot, promptsDir): AiRequest`;
  `parseVerification(text): { agreed: boolean; quote: string | null; reason: string }`;
  `verifyFact(router, fact, snapshot, primaryProviderId, promptsDir, options?): Promise<{ status: 'verified' | 'provisional'; reason: string }>`;
  `options` is `{ officialHosts?: string[]; today?: string; fetchImpl?: FetchLike }`.

- [ ] **Step 1: Write the failing tests**

Dates:
- `3 November 2027`, `3 Nov 2027`, `November 3, 2027`, `2027-11-03` all support
  `2027-11-03`;
- `03/11/2027` does **not** support it (ambiguous day/month);
- `13/11/2027` supports `2027-11-13` (day > 12);
- a different year does not support it;
- `isPlausibleDeadline` accepts a date within three years, rejects one in the
  past, and rejects one more than three years ahead.

URLs:
- exact host and subdomain are allowed;
- `chevening.org.evil.com` is not;
- `http://` is not;
- a 200 same-host response is ok;
- a redirect to an allowed subdomain is ok;
- a redirect to `evil.com`, a 404, or a network error is not.

Verification:
- a fact whose quote is absent is provisional without calling the router;
- a fact with no second provider available is provisional;
- agreement + a supporting quote is verified;
- disagreement is provisional;
- the verifier is called with `exclude: [primaryProviderId]`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-verify.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement dates and URLs**

`normalizeText`: lowercase, replace curly quotes/dashes with ASCII, collapse
whitespace, strip punctuation except digits/letters/`/`/`-`/`.`.

`quoteSupportsDate`: build the candidate day/month/year in the accepted formats
and check the normalized quote. For numeric dates, accept `D/M/YYYY` or
`D-M-YYYY` only when `day > 12`; accept `YYYY-MM-DD` always. Month names accept
three-letter abbreviations and full names.

`isAllowedHost`: `host === allowed || host.endsWith('.' + allowed)`; lowercase,
strip a leading `www.`.

`checkApplyUrl`: require HTTPS; `fetch` with `method: 'HEAD'`, `redirect:
'follow'`, 15s timeout; on 405 use GET with `Range: bytes=0-0`. Accept 200–399;
reject if the final host is not allowed. Return a reason string for the report.

`isPlausibleDeadline`: parse the ISO date at UTC midnight; true when
`today <= date <= today + 3 years`; false otherwise. The orchestrator also
rejects a deadline earlier than the extracted `opens` date.

- [ ] **Step 4: Implement verification**

`verify.md` asks: "Does the source support this exact value? Return
`{"agreed":true|false,"quote":"...","reason":"..."}`. Quote the sentence. Do not
use outside knowledge." `parseVerification` validates with zod.

`verifyFact` order: deterministic quote check → for `applyUrl`, `checkApplyUrl`
→ `router.available('verify', [primaryProviderId])`; if empty, provisional →
call `router.complete` with `exclude` → require `agreed` and a verifier quote
that appears in the source and supports the value. On any failure return
`provisional` with the reason; never throw for a single bad fact.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/dates.ts scripts/pipeline/urls.ts scripts/pipeline/verify.ts pipeline/prompts/verify.md tests/unit
git commit -m "feat: add deterministic fact checks and two-model verification"
```

---

### Task 7: Merge, status derivation, and atomic publish

**Files:**
- Create: `scripts/pipeline/publish.ts`
- Test: `tests/unit/pipeline-publish.test.ts`

**Interfaces:**
- Consumes: `Program`, `Cycle` from `src/lib/schema`; `Extraction`,
  `SourceConfig`, `EvidenceFact`; `deriveCycleStatus` from Task 1.
- Produces: `cycleIdFromLabel(label, fallbackDate): string`;
  `mergeExtraction(program, extraction, source, options): Program`;
  `writeProgramFile(program, dataDir): void`;
  `setRunStatusLive(path, now): void`.
  `options` is `{ today: string; now: Date; verifiedFields: Set<string>;
  guideVerified: boolean }`; field names are `deadline`, `opens`,
  `resultsDate`, `studyStart`, and `applyUrl`.

- [ ] **Step 1: Write the failing tests**

- a new cycle is appended, existing cycles are untouched, and `firstSeen` stays;
- a cycle with the same `cycleId` is updated, not duplicated (extension case);
- `cycleIdFromLabel('2027/28 intake', null)` returns `'2027'`;
- a null extracted date keeps the existing date;
- a verified deadline updates the date and sets `verification.deadline` to
  `verified`;
- a provisional deadline for a cycle whose existing deadline is verified does
  **not** replace the date (last good data wins);
- a provisional deadline for an unverified cycle updates the date but keeps the
  verification `provisional`;
- an unverified `opens` date keeps the existing `opens`; a verified `opens`
  date updates it;
- a verified apply URL updates `apply.url`; an unverified one does not replace
  an existing verified URL;
- a guide is replaced only when `options.guideVerified` is true;
- status is derived: future opens → upcoming, past deadline → closed, deadline
  today → open;
- identity fields (`programId`, `title`, `provider`, `country`, `officialUrl`,
  `fundedLevels`, `applicantStages`, `eligibility`, `funding`) are unchanged;
- `writeProgramFile` writes valid JSON and leaves no `.tmp`;
- `setRunStatusLive` writes `mode: 'live'` and an ISO timestamp.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-publish.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the merge**

`mergeExtraction` clones the program, finds or appends each extracted cycle by
`cycleId`, and applies the rules above. `opens`, `resultsDate`, and `studyStart`
update only when their field is in `verifiedFields`; otherwise the existing
value is kept. `setRunStatusLive` writes `{ mode: 'live', lastSuccessfulRun:
now.toISOString() }`; only the orchestrator calls it, and only when the run is
allowed to go live. Merge evidence by `field`: replace the
entry with the same field, keep unrelated entries. Add/replace the source entry
with `lastVerified = today`. Set `confidence` to the fraction of verified fields
(`deadline`, `applyUrl`) out of those present. Set `lastUpdated` to
`options.now.toISOString()`; never change `firstSeen`.

Status: `deriveCycleStatus(updatedDates, options.today)`; keep `archived` if the
existing status is `archived`; keep the existing status when the derivation is
null.

Validate with `ProgramSchema.parse` before writing. Write with two-space JSON and
a trailing newline, temp file + rename.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/publish.ts tests/unit
git commit -m "feat: merge verified facts and publish program data atomically"
```

---

### Task 8: Orchestrator, run report, and CLI

**Files:**
- Create: `scripts/pipeline/run.ts`, `report.ts`, `main.ts`
- Test: `tests/unit/pipeline-run.test.ts`, `pipeline-report.test.ts`
- Modify: `package.json` (`pipeline` script)

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: `runPipeline(options): Promise<{ summary: RunSummary; report:
  RunReport }>`; `writeReport(config, report): string`;
  `renderSummary(report): string`;
  `parseArgs(argv): CliOptions` (exported from `main.ts` for tests).
  `options` is `{ config: PipelineConfig; router: Router; store?: StateStore;
  fetchImpl?: FetchLike; now: Date; dryRun: boolean; maxItems: number;
  sourceId?: string; allowLive: boolean; sleep?: (ms: number) => Promise<void>;
  random?: () => number }`. `RunSummary` is `{ runId, status, published:
  string[], unchanged: string[], failed: string[], paused: string[],
  unhealthy: string[], candidates: number, checked: number }`. `runPipeline`
  writes the report itself unless `dryRun`.

- [ ] **Step 1: Write the failing tests**

Use a temp root with `pipeline/sources.json`, one copied Chevening program, and
`src/data/run-status.json`. Use a fake `fetch` returning fixture HTML and a fake
`Router`.

- a successful item publishes the program, marks the item `published`, sets the
  run `complete`, and (with `allowLive: true`) sets run-status `live`;
- an unchanged successful run with `allowLive: true` refreshes
  `lastSuccessfulRun` and keeps `mode: 'live'`;
- a run with one item failure publishes the good item but does not set
  run-status `live`;
- `dryRun: true` writes no program, no state, and no run-status;
- an unchanged hash on the second run skips extraction (router call count 0);
- a `ProvidersExhaustedError` marks the run `paused` and leaves the item
  `pending`; a second run with a working router resumes and publishes;
- one source failing does not stop another source from publishing; the report
  contains both outcomes;
- an extraction validation error marks the item `failed`; after `maxAttempts`
  it becomes `dead`;
- a source with `archived: true` is skipped;
- a page shorter than 400 characters is suspicious: no publish, source failure
  recorded, last good data intact;
- a source with five consecutive fetch failures is retired and skipped on the
  next run, and that run does not set run-status `live`;
- a source whose `nextEligibleAt` is in the future is skipped;
- the run report JSON is written and the summary contains the published and
  failed counts.

`parseArgs`:
- defaults: `maxItems: 20`, `dryRun: false`, `live: false`;
- `--max-items 5`, `--source chevening`, `--dry-run`, `--live` parse;
- an unknown flag throws.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-run.test.ts tests/unit/pipeline-report.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the orchestrator**

`runPipeline`:
1. Load config paths, registry, state, programs, run-status.
2. Start or resume a run; `runId = now.toISOString().replace(/[:.]/g, '-')`.
3. Build the queue from non-archived sources (optionally one `sourceId`):
   `{ sourceId, programId, url }` per `pageUrl`. Skip items already `published`
   or `dead`; retry every other item. Content errors dead-letter at
   `maxAttempts`; fetch failures stay `failed` and are governed by source
   retirement, so a permanently broken host can reach five failures.
4. For each item, up to `maxItems`:
   - skip when the source is `retired` or `nextEligibleAt > now`; count it as
     skipped and add it to `unhealthy`.
   - robots check; on deny mark `dead` and report.
   - fetch text; on failure increment source failures, set `nextEligibleAt` to
     `now + min(24h, 15min * 2^failures)`, mark item `failed` without
     dead-lettering; at five failures set `retired: true`.
   - hash; if equal to `state.pages[itemKey].hash`, mark `published`, count it
     as `unchanged`, and continue.
   - suspicion check: if `snapshot.text.length < 400`, or the previous
     `textLength` was non-zero and the new length is below 40% of it, mark the
     item `failed`, record "suspicious page", and keep the old data.
   - build/parse/validate extraction; on error mark `failed`.
   - build `verifiedFields`: `deadline` and `applyUrl` only when `verifyFact`
     returns `verified`; `opens`, `resultsDate`, and `studyStart` only when the
     quote appears in the source, supports the date, and
     `isPlausibleDeadline` passes (for `opens`, allow past dates; for results
     and study, allow up to four years). Reject a deadline before `opens`.
   - `guideVerified` is true when every non-empty guide item has an evidence
     quote that appears in the source.
   - merge and write the program unless `dryRun`.
   - mark `published`, update `state.pages[itemKey]` with hash and
     `textLength`, reset source failures, persist.
5. Catch `ProvidersExhaustedError`: mark the item `pending`, run `paused`,
   persist, return a paused summary.
6. If the queue is exhausted, mark `complete`; call `setRunStatusLive` only
   when `allowLive`, not `dryRun`, `checked > 0`, `failed.length === 0`, and
   `unhealthy === 0`. `unhealthy` counts active sources skipped because they
   are retired or inside a backoff window. A run where every page is unchanged
   still refreshes `lastSuccessfulRun`.
7. Write the report; return counts.

`dryRun` keeps state in memory, does not call `saveState`, does not write
programs, and does not touch run-status.

Per-source isolation: wrap each item in `try/catch`; one failure never aborts
the run. A run with zero checked items and at least one failure returns
`failed`; partial success returns `complete` with `failed` counts.

`report.ts`: JSON shape `{ runId, startedAt, finishedAt, status, published:
string[], unchanged: string[], skipped: string[], failed: {item,error}[],
paused: string[], unhealthy: string[], candidates: number, checked: number,
sources: Record<string,{fetched,published,failed}>, providers:
Record<string,{calls,errors,cooldowns}> }`. Write to
`pipeline/runs/<runId>.json`. `renderSummary` returns Markdown lines for
`$GITHUB_STEP_SUMMARY`.

`main.ts`: `parseArgs` with `node:util`; build providers from config; if none,
print `No AI providers configured — pipeline skipped.` and exit 0 without
writing. Build one `StateStore` and pass it to both the router and the
orchestrator; run; print the summary; append to `GITHUB_STEP_SUMMARY` when set;
exit 0 for complete/paused/skipped, 1 for failed.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/run.ts scripts/pipeline/report.ts scripts/pipeline/main.ts package.json tests/unit
git commit -m "feat: add the resumable pipeline orchestrator, reports, and CLI"
```

---

### Task 9: Discovery queue for new scholarships

**Files:**
- Create: `scripts/pipeline/discover.ts`, `pipeline/prompts/discover.md`,
  `pipeline/candidates.json`
- Test: `tests/unit/pipeline-discover.test.ts`

**Interfaces:**
- Consumes: `Router`, `SourceConfig`, `PageSnapshot`, `EvidenceFact`.
- Produces: `CandidateSchema`;
  `discoverFromIndex(router, source, snapshot, existing, now, promptsDir): Promise<Candidate[]>`;
  `extractSitemapLinks(xml, baseUrl): string[]`;
  `parseCandidates(text): Candidate[]`;
  `loadCandidates(path): Candidate[]`; `saveCandidates(path, candidates): void`.

- [ ] **Step 1: Write the failing tests**

- links on the official host matching scholarship keywords are considered;
- off-host links, PDFs, and non-scholarship paths are skipped;
- a page classified as a scholarship with a valid title, provider, official URL,
  and a supported deadline becomes a `pending-review` candidate;
- a page classified as not a scholarship is skipped;
- a candidate with an unsupported quote or a disallowed apply URL is skipped;
- an existing candidate URL or normalized title is not duplicated;
- `extractSitemapLinks` reads `<loc>` entries, resolves relative URLs, and keeps
  only allowed hosts;
- `saveCandidates` writes valid JSON atomically;
- no function writes to `src/data/programs/` (assert the directory is
  unchanged).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/pipeline-discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement discovery**

`discover.md` asks for `{ isScholarship, title, provider, country, deadline,
applyUrl, evidence }` with the same quote rules. `discoverFromIndex` filters
links by allowed host and `/(scholarship|scholarships|funding|bursary|award|grant)/i`,
caps at 10 new links, fetches each, calls the router with task `discover`, and
validates the result. Also fetch `${origin}/sitemap.xml` once per discovery
source, run it through `extractSitemapLinks`, and merge those candidates with
the index links (dedupe by URL) before the cap. Queue only when
`isScholarship` is true and title, provider, official URL, and at least one
evidence quote are present. A missing deadline is allowed. Never publish.

`Candidate` shape: `{ candidateId, title, provider, country, officialUrl,
deadline, applyUrl, evidence, sourceId, discoveredAt, status: 'pending-review' }`.
`candidateId` is a slug of title + deadline year, unique against existing
candidates. Dedupe against existing candidates by `normalizeUrl(officialUrl)`
and by normalized title.

- [ ] **Step 4: Wire discovery into the orchestrator**

After the known-program queue is exhausted, if the run is not paused, process
discovery indexes for sources with `discovery: true`. Respect `maxItems` and the
daily cap. Save candidates after each accepted item. A discovery failure is
reported but does not fail the run.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/discover.ts pipeline/prompts/discover.md pipeline/candidates.json scripts/pipeline/run.ts tests/unit
git commit -m "feat: discover official scholarship pages into a review queue"
```

---

### Task 10: Golden fixtures and the eval script

**Files:**
- Create: `pipeline/fixtures/chevening.html`, `chevening.extraction.json`,
  `daad.html`, `daad.extraction.json`, `unknown.html`,
  `unknown.extraction.json`, `index.html`, `index.discover.json`,
  `cases.json`
- Create: `scripts/pipeline/eval.ts`
- Modify: `package.json` (`eval` script)
- Modify: `.github/workflows/ci.yml` (run `npm run eval`)
- Test: `tests/unit/pipeline-eval.test.ts`

**Interfaces:**
- Consumes: `htmlToText`, `parseExtraction`, `validateExtraction`,
  `mergeExtraction`, `parseCandidates`.
- Produces: `runEval(root?): Promise<{ passed: number; failed: string[] }>`.

- [ ] **Step 1: Write the failing test**

`pipeline-eval.test.ts`:
- `runEval()` returns zero failures for the committed fixtures;
- a case with a quote absent from the HTML is reported as a failure (mutate a
  copy in a temp dir);
- a case with an invalid extraction JSON is reported as a failure.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/pipeline-eval.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the fixtures**

`chevening.html` includes a deadline sentence (`3 November 2027`), an apply
link on `chevening.org`, and a short guide. `chevening.extraction.json` is a
recorded model output with matching quotes. `daad.html` covers an upcoming
cycle with a provisional deadline. `unknown.html` is a news page that must
classify as `unknown`. `index.html` links to one scholarship page and one news
page; `index.discover.json` is the recorded discovery output.

`cases.json` maps each HTML file to its recorded output, the target
`programId`, and the expected cycle count/status.

- [ ] **Step 4: Implement `runEval` and the CLI**

For each case: `htmlToText`, `parseExtraction`, `validateExtraction`, merge into
a copy of the program named by `programId`, and assert the expected cycle count
and status. For discovery, `parseCandidates` and assert the queued count. Print
`PASS`/`FAIL` per case; exit 1 on any failure. `npm run eval` runs
`tsx scripts/pipeline/eval.ts`.

- [ ] **Step 5: Add the CI step**

In `.github/workflows/ci.yml`, after `npm test`, add `- run: npm run eval`.

- [ ] **Step 6: Run the eval, tests, and typecheck**

Run: `npm run eval && npm test && npm run typecheck`
Expected: all cases pass; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add pipeline/fixtures scripts/pipeline/eval.ts package.json package-lock.json .github/workflows/ci.yml tests/unit
git commit -m "test: add golden fixtures and the pipeline eval"
```

---

### Task 11: Daily workflow and operations docs

**Files:**
- Create: `.github/workflows/pipeline.yml`, `.env.example`
- Modify: `docs/runbook.md`, `AGENTS.md` (commands only)
- Modify: `package.json` (scripts already added)

**Interfaces:**
- Consumes: `npm run pipeline -- --live --max-items 20`.
- Produces: a scheduled workflow that commits data, state, and reports.

- [ ] **Step 1: Write the workflow**

```yaml
name: Data pipeline
on:
  schedule:
    - cron: '0 2 * * *'   # 07:00 Asia/Karachi
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: data-pipeline
  cancel-in-progress: false
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v7
        with: { ref: main, fetch-depth: 0 }
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - name: Refresh in checkpointed segments
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_MODEL: ${{ secrets.CLOUDFLARE_MODEL }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_MODEL: ${{ secrets.OPENROUTER_MODEL }}
        run: |
          set -uo pipefail
          for i in $(seq 1 10); do
            npm run pipeline -- --live --max-items 20
            code=$?
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add src/data pipeline
            if ! git diff --cached --quiet; then
              git commit -m "data: refresh scholarships $(date -u +%F)" || exit 1
              git pull --rebase origin main || exit 1
              git push origin HEAD:main || exit 1
            fi
            [ "$code" -ne 0 ] && exit "$code"
            if [ -f pipeline/state.json ]; then
              status=$(node -e "const s=require('./pipeline/state.json'); process.stdout.write(s.run?.status ?? 'complete')")
            else
              status=complete
            fi
            [ "$status" != "running" ] && break
          done
      - name: Upload run reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: pipeline-reports
          path: pipeline/runs/
          retention-days: 30
          if-no-files-found: ignore
```

- [ ] **Step 2: Add `.env.example`**

List the five optional provider keys and the two model overrides. Never include
real keys.

- [ ] **Step 3: Update the runbook**

Add: how to add provider secrets; how to trigger a manual run; what each state
value means; how to resume after a pause; how to inspect `pipeline/runs/`; how
to roll back a bad data commit; how to add a source to `pipeline/sources.json`;
where candidates go and that they are not published; the workflow permission
requirement (Settings → Actions → General → Workflow permissions → Read and
write); and that `run-status.json` flips to `live` only after a successful run.
Note that GitHub emails the repository owner when a scheduled workflow fails, so
no extra alert service is needed. Note that a manual dispatch always checks out
`main`, so a feature branch cannot publish data.

- [ ] **Step 4: Verify the YAML and the dry-run CLI**

Run: `npm run pipeline -- --dry-run`
Expected: `No AI providers configured — pipeline skipped.` and exit 0, with no
changes to `src/data/` or `pipeline/`.

Run: `git status --short`
Expected: only the files added in this task.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/pipeline.yml .env.example docs/runbook.md AGENTS.md
git commit -m "ci: add the daily pipeline workflow and operations guide"
```

---

### Task 12: Offline rehearsal and trust audit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-27-data-pipeline-harness.md` (check
  boxes)
- Test: full suite (no new test file)

- [ ] **Step 1: Run every check**

```bash
npm run typecheck
npm test
npm run eval
npm run build
npm run test:e2e
```

Expected: 0 type errors; all unit tests pass; all eval cases pass; the build
succeeds; all e2e tests pass.

- [ ] **Step 2: Confirm the trust invariants**

- `src/data/run-status.json` is still `{"mode":"sample","lastSuccessfulRun":null}`.
- `npm run pipeline -- --dry-run` makes no file changes.
- No secret-shaped string is in the repo: `git grep -nE "AIza|gsk_|sk-or-v1|CLOUDFLARE_API_TOKEN=."` returns nothing.
- Every seed cycle's status matches `deriveCycleStatus` at `2026-11-27`.
- No program file gained a new `programId` or lost a cycle.

- [ ] **Step 3: Review the diff against the spec**

Check each spec requirement in sections 7–9b against a task: fetch, hash, skip
unchanged, extract with quotes, deterministic checks, two-model verify, dedupe,
checkpoint/resume, per-source isolation, report, provider cooldowns, daily cap,
discovery queue, and no autonomous new-program publishing.

- [ ] **Step 4: Mark the plan complete and commit**

```bash
git add docs/superpowers/plans/2026-11-27-data-pipeline-harness.md
git commit -m "docs: record the pipeline rehearsal and trust audit"
```

- [ ] **Step 5: Open the PR and wait for CI**

```bash
git push -u origin plan-2-pipeline
gh pr create --base main --head plan-2-pipeline --title "Add the daily data pipeline and agent harness" --body "Implements Plan 2: fetch, extract, verify, checkpoint, publish, report, and discovery. The site stays on sample data until a real run succeeds."
gh pr checks --watch
```

Merge only when CI is green. Do not merge if `run-status.json` changed to
`live` in the PR.
