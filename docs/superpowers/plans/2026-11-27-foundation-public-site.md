# Foundation & Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable static scholarship site — real data schema, seed listings, researched design system, filters, listing guides, archive, and an on-device application tracker — ready for the daily pipeline to fill with real data.

**Architecture:** Astro static site with TypeScript, Tailwind, and zod-validated JSON data. Pages are prebuilt; filtering, sorting, and the tracker run in the browser. No server, no database, no public accounts. Deployed on Cloudflare Pages.

**Tech Stack:** Astro (current stable), TypeScript (strict), Tailwind CSS (current), zod, Vitest, Playwright, @axe-core/playwright, Fontsource (self-hosted fonts), GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-11-26-scholarship-tracker-design.md`

## Global Constraints

- $0 running cost; no paid services or paid tiers.
- No public accounts; application tracking lives only in the browser (localStorage).
- Mobile-first; target under ~2 seconds on a mid-range phone on mobile data.
- Index payload for 2,000 listings must stay under 300 KB gzipped.
- Data must match the spec's `Program` / `Cycle` schema exactly (section 7).
- An unverified deadline is **never** rendered as a date (section 6).
- The Apply button appears only when the cycle's `applyUrl` verification is `verified`.
- Eligibility wording is always "Likely eligible", never "you qualify".
- English UI. No third-party trackers. Accessibility target: WCAG AA, no serious
  or critical axe violations.
- Dates are stored as `YYYY-MM-DD` and formatted in UTC to avoid timezone drift.
- Cycle `status` is the source of truth for open/upcoming/closed; the site does not
  infer status from dates (the pipeline updates statuses).
- Node: current LTS. Pin dependencies at install time; commit the lockfile.

## Execution and resume

- Executed with `superpowers:subagent-driven-development`: one implementer per
  task, a fresh reviewer after each, a whole-branch review at the end.
- The durable record is the SDD ledger
  (`.superpowers/sdd/<plan>/progress.md`) plus git commits. On interruption or
  a quota/API limit, resume at the first task without a `Task N: complete` line;
  never re-dispatch completed tasks.
- Check off each plan step as it lands and commit per task so any agent can
  resume from the repository alone.
- Parallel work is allowed only when tasks touch disjoint files and do not
  depend on each other; implementation agents never share a working tree.

## Review Focus

1. **Partial data:** missing deadline, null apply URL, missing eligibility fields.
   Expected: graceful text ("not confirmed", "check official page"), never a
   fabricated value. Tested in Tasks 2, 6, 9.
2. **Multi-cycle programs:** an archived old cycle next to an open new one.
   Expected: cards and listing pages show the next open cycle; archive shows
   closed cycles labelled as such. Tested in Tasks 3, 9, 10.
3. **Level mapping edge cases:** matric, PhD, "all", multi-stage programs, and an
   empty nationality list (treated as open). Expected: conservative, explained
   results. Tested in Task 4.
4. **Corrupted or absent localStorage / bad import code.** Expected: page still
   works, tracker falls back to empty, invalid import is rejected with a message.
   Tested in Task 11.
5. **Empty results and missing dates in filters/sorts.** Expected: clear empty
   state, no crashes, null deadlines sorted last. Tested in Tasks 5, 8.

---

## File Structure

```
package.json, astro.config.mjs, tsconfig.json, vitest.config.ts,
playwright.config.ts, .github/workflows/ci.yml
src/
  lib/
    constants.ts      # levels, statuses, app name, limits
    schema.ts         # zod schemas + inferred types (server/build only)
    data.ts           # build-time JSON loader + selectors (server/build only)
    eligibility.ts    # level mapping + conservative eligibility
    filters.ts        # pure filter/sort/index-entry functions
    format.ts         # dates, deadlines, money, labels
    tracker.ts        # localStorage tracker, export/import
  layouts/BaseLayout.astro
  components/
    Header.astro, Footer.astro, FreshnessBanner.astro,
    FilterBar.astro, ListingCard.astro, EmptyState.astro, Pagination.astro,
    VerificationBadge.astro, FundingBadge.astro, EligibilityNote.astro,
    GuideSection.astro, TrackerControls.astro, ShareButton.astro,
    ReportIssueLink.astro
  pages/
    index.astro, archive.astro, my-applications.astro, about.astro, 404.astro,
    listing/[slug].astro
  scripts/
    home.ts, listing.ts, tracker-page.ts
  styles/global.css
  data/
    programs/*.json   # 9 seed programs
    run-status.json
tests/
  unit/{schema,data,eligibility,filters,format,tracker,freshness,index-size}.test.ts
  e2e/{layout,home,listing,archive,tracker,meta,a11y}.spec.ts
docs/design-direction.md
docs/runbook.md
```

---

### Task 1: Scaffold, tooling, and CI

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `src/lib/constants.ts`, `src/pages/index.astro`, `src/styles/global.css`, `tests/unit/smoke.test.ts`, `README.md`

**Interfaces:**
- Produces: `APP_NAME = "Scholarship Tracker"` and `PUBLIC_REPO_URL = "https://github.com/OWNER/REPO"` (placeholder; the owner updates it) in `src/lib/constants.ts`; npm scripts `dev`, `build`, `preview`, `test`, `test:e2e`, `typecheck`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/smoke.test.ts
import { expect, test } from 'vitest'
import { APP_NAME } from '../../src/lib/constants'

test('app name is set', () => {
  expect(APP_NAME).toBe('Scholarship Tracker')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the project**

Create `package.json` with the scripts above. Install current stable:
`astro`, `typescript`, `@types/node`, `@astrojs/check`, `@tailwindcss/vite`,
`tailwindcss`, `zod`, `vitest`, `@playwright/test`, `@axe-core/playwright`.
Configure `astro.config.mjs` with the Tailwind Vite plugin, `tsconfig.json` with
`strict: true`, Vitest (node environment), and Playwright (chromium, `npm run preview`).
Create `src/lib/constants.ts`, a placeholder `src/pages/index.astro`, and
`src/styles/global.css` with the Tailwind import.

- [ ] **Step 4: Verify**

Run: `npm test` → PASS. Run: `npm run build` → succeeds, `dist/` produced.

- [ ] **Step 5: Add CI and commit**

`.github/workflows/ci.yml`: on push/PR — setup Node, `npm ci`, `npm run typecheck`,
`npm test`, `npm run build`, install Playwright chromium, `npm run test:e2e`.
Commit: `chore: scaffold Astro site with tests and CI`.

---

### Task 2: Schema and seed data

**Files:**
- Create: `src/lib/schema.ts`, `src/data/programs/*.json` (9 files), `tests/unit/schema.test.ts`
- Modify: `src/lib/constants.ts`

**Interfaces:**
- Produces in `constants.ts`: `STUDY_LEVELS = ['matric','intermediate','bachelor','master','phd'] as const`, `type StudyLevel`, `VERIFICATION_STATUSES = ['verified','provisional','unverified'] as const`, `type VerificationStatus`, `CYCLE_STATUSES = ['open','upcoming','closed','archived'] as const`.
- Produces in `schema.ts`: `CycleSchema`, `ProgramSchema`, `type Cycle`, `type Program`, `parseProgram(input: unknown): Program`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/schema.test.ts
import { expect, test } from 'vitest'
import { parseProgram } from '../../src/lib/schema'
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync('src/data/programs/chevening-pakistan.json', 'utf8'))

test('valid seed program parses', () => {
  expect(parseProgram(seed).programId).toBe('chevening-pakistan')
})

test('programId must be a lowercase slug', () => {
  expect(() => parseProgram({ ...seed, programId: 'Bad ID' })).toThrow()
})

test('a program needs at least one cycle', () => {
  expect(() => parseProgram({ ...seed, cycles: [] })).toThrow()
})

test('unknown verification status is rejected', () => {
  const bad = structuredClone(seed)
  bad.cycles[0].verification.deadline = 'maybe'
  expect(() => parseProgram(bad)).toThrow()
})

test('null deadline is allowed', () => {
  const ok = structuredClone(seed)
  ok.cycles[0].dates.deadline = null
  expect(parseProgram(ok).cycles[0].dates.deadline).toBeNull()
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/schema.test.ts`
Expected: FAIL — `parseProgram` not found.

- [ ] **Step 3: Implement the schema and seed data**

Implement `ProgramSchema`/`CycleSchema` exactly as in spec section 7:
`programId` regex `^[a-z0-9-]+$`, ISO date strings for dates, `confidence` 0–1,
`cycles.min(1)`, enums from constants.

Create 9 seed programs covering: fully funded (Chevening), provisional deadline
(Fulbright), stipend (DAAD), bachelor's (Türkiye Bursları), multi-cycle with an
archived old cycle plus an open new one (Erasmus Mundus), local partial funding
(HEC need-based), provisional/unverified apply link (Sindh Endowment Fund), a
matric-level program, and one archived-only program (Commonwealth 2025) so the
archive has content. Use fixed 2027–2028 dates and explicit cycle `status` values.
All seed files are demo data (the banner in Task 13 says so).

Exact filenames: `chevening-pakistan.json`, `fulbright-pakistan.json`,
`daad-epos.json`, `turkiye-burslari.json`, `erasmus-mundus-joint-masters.json`,
`hec-need-based.json`, `sindh-endowment-fund.json`, `sindh-matric-scholarship.json`,
`commonwealth-pakistan-2025.json`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/schema.test.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add program schema and seed listings`

---

### Task 3: Data loader and selectors

**Files:**
- Create: `src/lib/data.ts`, `tests/unit/data.test.ts`

**Interfaces:**
- Produces:
  - `loadPrograms(): Program[]` — reads every `src/data/programs/*.json`, validates, throws on duplicate `programId` or invalid file (message includes filename).
  - `getProgram(programs: Program[], slug: string): Program | undefined`
  - `isActive(program: Program): boolean` — any cycle `status` in `open|upcoming`.
  - `nextCycle(program: Program): Cycle | undefined` — earliest deadline among `open|upcoming`; ties/nulls ordered after dated cycles.
  - `activePrograms(programs: Program[]): Program[]`, `archivedPrograms(programs: Program[]): Program[]` — sorted by title.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/data.test.ts
import { expect, test } from 'vitest'
import { activePrograms, archivedPrograms, isActive, loadPrograms, nextCycle } from '../../src/lib/data'

test('loads and validates all seed programs', () => {
  const programs = loadPrograms()
  expect(programs.length).toBe(9)
  expect(new Set(programs.map(p => p.programId)).size).toBe(9)
})

test('multi-cycle program is active and nextCycle picks the open cycle', () => {
  const erasmus = loadPrograms().find(p => p.programId === 'erasmus-mundus-joint-masters')!
  expect(isActive(erasmus)).toBe(true)
  expect(nextCycle(erasmus)!.status).toBe('open')
})

test('archived-only program is not active', () => {
  const programs = loadPrograms().map(p => ({
    ...p,
    cycles: p.cycles.map(c => ({ ...c, status: 'closed' as const })),
  }))
  expect(activePrograms(programs)).toHaveLength(0)
  expect(archivedPrograms(programs)).toHaveLength(9)
})

test('nextCycle ignores closed cycles', () => {
  const p = loadPrograms().find(p => p.programId === 'erasmus-mundus-joint-masters')!
  const cycle = nextCycle(p)!
  expect(cycle.status).not.toBe('closed')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/data.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Use `node:fs`/`node:path` (build-time only; never import this from client scripts).
Collect parse errors with the filename. Duplicate IDs throw. Implement the
selectors with injected-free logic (status-driven, no wall clock).

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/data.test.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add build-time data loader and cycle selectors`

---

### Task 4: Eligibility engine

**Files:**
- Create: `src/lib/eligibility.ts`, `tests/unit/eligibility.test.ts`

**Interfaces:**
- Produces:
  - `stagesForCurrentLevel(current: StudyLevel): StudyLevel[]` — matric→`['intermediate']`; intermediate→`['bachelor']`; bachelor→`['master']`; master→`['phd']`; phd→`['phd']`.
  - `EligibilityInput { currentLevel: StudyLevel; nationality: 'PK'; age?: number }`
  - `EligibilityResult { likelyEligible: boolean; reasons: string[] }`
  - `evaluateEligibility(program: Program, cycle: Cycle, input: EligibilityInput): EligibilityResult`
- Rules: match if `applicantStages` includes the current level **or** any mapped next stage; nationality passes when `nationalities` is empty, contains `PK`, or contains `any`; age passes when `ageMax` is null, age is undefined (add reason "Age limit not checked"), or `age <= ageMax`; cycle must be `open` or `upcoming`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/eligibility.test.ts
import { expect, test } from 'vitest'
import { evaluateEligibility, stagesForCurrentLevel } from '../../src/lib/eligibility'
import { loadPrograms } from '../../src/lib/data'

const programs = loadPrograms()
const chevening = programs.find(p => p.programId === 'chevening-pakistan')!
const cheveningCycle = chevening.cycles.find(c => c.status === 'open')!

test('matric students look at intermediate programs', () => {
  expect(stagesForCurrentLevel('matric')).toEqual(['intermediate'])
})

test('Pakistani master student is likely eligible for Chevening', () => {
  const r = evaluateEligibility(chevening, cheveningCycle, { currentLevel: 'master', nationality: 'PK' })
  expect(r.likelyEligible).toBe(true)
})

test('a program restricted to another nationality is rejected', () => {
  const restricted = { ...chevening, eligibility: { ...chevening.eligibility, nationalities: ['US'] } }
  const r = evaluateEligibility(restricted, cheveningCycle, { currentLevel: 'master', nationality: 'PK' })
  expect(r.likelyEligible).toBe(false)
  expect(r.reasons.join(' ')).toContain('nationality')
})

test('age over the limit is rejected with a reason', () => {
  const p = { ...chevening, eligibility: { ...chevening.eligibility, ageMax: 25 } }
  const r = evaluateEligibility(p, cheveningCycle, { currentLevel: 'master', nationality: 'PK', age: 30 })
  expect(r.likelyEligible).toBe(false)
  expect(r.reasons.join(' ')).toContain('age')
})

test('closed cycle is not eligible', () => {
  const closed = { ...cheveningCycle, status: 'closed' as const }
  expect(evaluateEligibility(chevening, closed, { currentLevel: 'master', nationality: 'PK' }).likelyEligible).toBe(false)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/eligibility.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Implement the rules above. Keep reasons short, human-readable, and safe to show
under "Likely eligible — based on level, nationality and age." Never return the
phrase "you qualify".

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/eligibility.test.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add conservative eligibility engine`

---

### Task 5: Filters, sorting, and index entries

**Files:**
- Create: `src/lib/filters.ts`, `tests/unit/filters.test.ts`

**Interfaces:**
- Produces:
  - `ProgramIndexEntry { programId; slug; title; provider; country; fundedLevels; applicantStages; nextDeadline: string|null; deadlineVerified: boolean; fundingType; fundingScore: number; status: 'active'|'archived' }`
  - `toIndexEntry(program: Program): ProgramIndexEntry`
  - `FilterState { query; level: StudyLevel|'all'; currentLevel: StudyLevel; eligibleOnly; funding: 'all'|'fully'|'stipend'; deadlineWindow: 'all'|'30'|'90'; status: 'active'|'archived'|'all' }`
  - `filterIndex(entries, filters, now: Date, resolveProgram: (programId: string) => Program | undefined): ProgramIndexEntry[]`
  - `sortIndex(entries, sort: 'newest'|'best-funded'|'deadline'): ProgramIndexEntry[]` — null deadlines always last; stable.
  - `matchesQuery(entry, query): boolean` — case-insensitive across title, provider, country, funded levels.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/filters.test.ts
import { expect, test } from 'vitest'
import { filterIndex, sortIndex, toIndexEntry } from '../../src/lib/filters'
import { loadPrograms } from '../../src/lib/data'

const entries = loadPrograms().map(toIndexEntry)
const byId = new Map(loadPrograms().map(p => [p.programId, p]))
const resolve = (id: string) => byId.get(id)
const now = new Date('2026-11-27T00:00:00Z')

test('level filter keeps matching programs', () => {
  const out = filterIndex(entries, { query: '', level: 'master', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now, resolve)
  expect(out.length).toBeGreaterThan(0)
  expect(out.every(e => e.fundedLevels.includes('master'))).toBe(true)
})

test('eligible-only never returns archived entries', () => {
  const out = filterIndex(entries, { query: '', level: 'all', currentLevel: 'master', eligibleOnly: true, funding: 'all', deadlineWindow: 'all', status: 'all' }, now, resolve)
  expect(out.every(e => e.status === 'active')).toBe(true)
})

test('search is case-insensitive across title and provider', () => {
  const out = filterIndex(entries, { query: 'CHEVENING', level: 'all', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now, resolve)
  expect(out.some(e => e.programId === 'chevening-pakistan')).toBe(true)
})

test('deadline sort puts nulls last', () => {
  const out = sortIndex(entries, 'deadline')
  const firstNull = out.findIndex(e => e.nextDeadline === null)
  if (firstNull !== -1) {
    expect(out.slice(firstNull).every(e => e.nextDeadline === null)).toBe(true)
  }
})

test('empty filters return an empty list, not a crash', () => {
  const out = filterIndex(entries, { query: 'zzzz-no-match', level: 'all', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now, resolve)
  expect(out).toEqual([])
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/filters.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`toIndexEntry` uses `nextCycle`; `deadlineVerified` is true only when the chosen
cycle's `verification.deadline === 'verified'` **and** a date exists. Funding score:
fully funded 3, stipend 2, tuition 1, partial 0.5 (use `funding.type`).
Eligibility filtering reuses `evaluateEligibility` with the entry's program/cycle
data (keep a lookup map internally or accept a resolver parameter — do not fetch
at runtime).

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/filters.test.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add filter, sort, and index-entry logic`

---

### Task 6: Formatting helpers

**Files:**
- Create: `src/lib/format.ts`, `tests/unit/format.test.ts`

**Interfaces:**
- Produces:
  - `formatDate(iso: string): string` → e.g. `15 Jan 2027` (UTC, `en-GB`).
  - `formatDeadline(deadline: string|null, status: VerificationStatus): string` → verified date; `"Deadline not confirmed — check official page"` when unverified/provisional; `"No deadline listed"` when null.
  - `daysUntil(iso: string, now: Date): number`.
  - `formatMoney(amount: number, currency: string): string`.
  - `fundingLabel(type: FundingType): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/format.test.ts
import { expect, test } from 'vitest'
import { daysUntil, formatDate, formatDeadline } from '../../src/lib/format'

test('formats ISO dates in UTC', () => {
  expect(formatDate('2027-01-15')).toBe('15 Jan 2027')
})

test('unverified deadlines never render a date', () => {
  expect(formatDeadline('2027-01-15', 'provisional')).not.toContain('2027')
  expect(formatDeadline('2027-01-15', 'unverified')).toContain('not confirmed')
})

test('verified deadlines render the date', () => {
  expect(formatDeadline('2027-01-15', 'verified')).toContain('15 Jan 2027')
})

test('null deadline has its own copy', () => {
  expect(formatDeadline(null, 'unverified')).toBe('No deadline listed')
})

test('daysUntil is timezone-safe', () => {
  expect(daysUntil('2027-01-01', new Date('2026-12-30T00:00:00Z'))).toBe(2)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/format.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Use `Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })`.
Parse dates as `new Date(iso + 'T00:00:00Z')`. Keep the exact unverified copy.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/format.test.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add date and funding formatting helpers`

---

### Task 7: Design research, design system, and layout

**Files:**
- Create: `docs/design-direction.md`, `src/styles/global.css` (tokens), `src/layouts/BaseLayout.astro`, `src/components/Header.astro`, `src/components/Footer.astro`, `tests/e2e/layout.spec.ts`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Produces: `BaseLayout` props `{ title: string; description: string; canonicalPath?: string }`; CSS tokens for color, type, spacing, radius; dark mode via `data-theme` + `prefers-color-scheme`.

- [ ] **Step 1: Write the failing E2E test**

```ts
// tests/e2e/layout.spec.ts
import { expect, test } from '@playwright/test'

test('home renders header, footer, and a working theme toggle', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
  const toggle = page.getByRole('button', { name: /theme/i })
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/layout.spec.ts`
Expected: FAIL — no header/footer/toggle.

- [ ] **Step 3: Research and implement the design system**

Write `docs/design-direction.md`: 3 reference sites studied (education/product),
why their patterns work, chosen font pairing, palette with hex values, type scale,
spacing, and dark-mode mapping. Defaults unless the research gives a documented
better reason: **Source Serif 4** for headings, **Inter** for body, self-hosted via
Fontsource; deep emerald accent, warm neutral surfaces, AA contrast. Implement CSS
tokens, typography, focus styles, skip link, header (logo, About, My Applications,
theme toggle), footer (disclaimer, report link), and BaseLayout meta defaults.
Mobile-first; no horizontal scroll at 375px.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/layout.spec.ts` → PASS.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

`feat: add researched design system and site layout`

---

### Task 8: Home page with filters, sorting, pagination

**Files:**
- Create: `src/pages/index.astro` (real page), `src/scripts/home.ts`, `src/components/FilterBar.astro`, `src/components/ListingCard.astro`, `src/components/EmptyState.astro`, `src/components/Pagination.astro`, `src/components/FreshnessBanner.astro` (stub; implemented in Task 13), `tests/e2e/home.spec.ts`

**Interfaces:**
- Produces: home embeds `<script type="application/json" id="program-index">` containing `ProgramIndexEntry[]`; `home.ts` reads it, applies `filterIndex`/`sortIndex`, renders 24 cards per page, syncs filters to the URL, persists the chosen level in `localStorage` key `scholarship-level`, and shows the "Likely eligible" note when the eligible toggle is on.

- [ ] **Step 1: Write the failing E2E tests**

```ts
// tests/e2e/home.spec.ts
import { expect, test } from '@playwright/test'

test('lists seed programs and filters by level', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  const before = await page.getByTestId('listing-card').count()
  await page.getByLabel(/level/i).selectOption('phd')
  const after = await page.getByTestId('listing-card').count()
  expect(after).toBeLessThanOrEqual(before)
})

test('eligible toggle shows the honest note and only active items', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/eligible only/i).check()
  await expect(page.getByText(/Likely eligible/i)).toBeVisible()
})

test('search with no matches shows the empty state', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/search/i).fill('zzzz-no-match')
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('unverified deadlines are never rendered as dates', async ({ page }) => {
  await page.goto('/')
  const fulbright = page.getByTestId('card-fulbright-pakistan')
  await expect(fulbright).toContainText(/not confirmed/i)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/home.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

Render cards with title, provider, country, levels, funding badge, deadline via
`formatDeadline`, and a "Likely eligible" pill when applicable. Add filter bar
(search, level, eligible toggle, funding, deadline window), sort select, result
count, pagination, and empty state. Use `data-testid="listing-card"` and
`data-testid="card-<programId>"`.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/home.spec.ts` → PASS. `npm run build` → PASS.

- [ ] **Step 5: Commit**

`feat: add home listing page with filters and pagination`

---

### Task 9: Listing page with guide and trust rules

**Files:**
- Create: `src/pages/listing/[slug].astro`, `src/components/GuideSection.astro`, `src/components/VerificationBadge.astro`, `src/components/FundingBadge.astro`, `src/components/EligibilityNote.astro`, `src/components/TrackerControls.astro`, `src/components/ShareButton.astro`, `src/components/ReportIssueLink.astro`, `src/scripts/listing.ts`, `tests/e2e/listing.spec.ts`

**Interfaces:**
- Produces: static pages via `getStaticPaths`; cycle tabs (client) defaulting to `nextCycle`; Apply button rendered only when `cycle.verification.applyUrl === 'verified'` and `cycle.apply.url` is non-null; report link opens `https://github.com/<owner>/<repo>/issues/new?title=...&body=...` using `PUBLIC_REPO_URL` from `src/lib/constants.ts`.

- [ ] **Step 1: Write the failing E2E tests**

```ts
// tests/e2e/listing.spec.ts
import { expect, test } from '@playwright/test'

test('unverified apply link means no Apply button', async ({ page }) => {
  await page.goto('/listing/sindh-endowment-fund/')
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveCount(0)
  await expect(page.getByText(/check official page/i).first()).toBeVisible()
})

test('verified apply link shows the Apply button', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveAttribute('href', /^https:/)
})

test('guide, documents, and sources render', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await expect(page.getByRole('heading', { name: /how to apply/i })).toBeVisible()
  await expect(page.getByText(/documents/i).first()).toBeVisible()
  await expect(page.getByText(/last verified/i).first()).toBeVisible()
})

test('tracker save persists across reload', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.reload()
  await expect(page.getByText(/saved/i).first()).toBeVisible()
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/listing.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

Build the full listing page per spec section 6: guide steps, documents, timeline,
funding, eligibility, official sources with last-verified dates, trust label, and
the verification badges. Apply button only for verified URLs. Add tracker controls,
WhatsApp share, and report-issue link. Cycle tabs switch the displayed cycle
client-side without a reload.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/listing.spec.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add verified listing pages with guides and tracker controls`

---

### Task 10: Archive page

**Files:**
- Create: `src/pages/archive.astro`, `tests/e2e/archive.spec.ts`

**Interfaces:**
- Produces: archived programs (all cycles `closed|archived`) rendered with a
  "Closed" label; no Apply button; link to the official page labelled
  "View official page (closed cycle)".

- [ ] **Step 1: Write the failing E2E test**

```ts
// tests/e2e/archive.spec.ts
import { expect, test } from '@playwright/test'

test('archive shows only closed programs and no Apply buttons', async ({ page }) => {
  await page.goto('/archive/')
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  await expect(page.getByText(/closed/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /^Apply/i })).toHaveCount(0)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/archive.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

Reuse the index and card components with `status: 'archived'`. Add the same search
and level filters. Label closed cycles clearly.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/archive.spec.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add closed-scholarship archive`

---

### Task 11: Tracker library and My Applications page

**Files:**
- Create: `src/lib/tracker.ts`, `src/pages/my-applications.astro`, `src/scripts/tracker-page.ts`, `tests/unit/tracker.test.ts`, `tests/e2e/tracker.spec.ts`

**Interfaces:**
- Produces:
  - `TrackerState { version: 1; entries: TrackerEntry[] }`
  - `TrackerEntry { programId; cycleId; status: 'saved'|'applied'|'interview'|'offer'|'rejected'; note: string; updatedAt: string }`
  - `loadTracker(storage?: Pick<Storage,'getItem'>): TrackerState` — safe fallback on bad JSON.
  - `upsertEntry(state, entry): TrackerState`, `removeEntry(state, programId, cycleId): TrackerState`
  - `exportTracker(state): string` (base64), `importTracker(code: string): TrackerState` (throws `TrackerImportError` on invalid).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/tracker.test.ts
import { expect, test } from 'vitest'
import { exportTracker, importTracker, loadTracker, removeEntry, upsertEntry } from '../../src/lib/tracker'

const entry = { programId: 'chevening-pakistan', cycleId: '2027', status: 'applied' as const, note: '', updatedAt: '2026-11-27T00:00:00Z' }

test('corrupted storage falls back to empty state', () => {
  const storage = { getItem: () => '{not json' }
  expect(loadTracker(storage)).toEqual({ version: 1, entries: [] })
})

test('export/import round-trips', () => {
  const state = upsertEntry({ version: 1, entries: [] }, entry)
  expect(importTracker(exportTracker(state))).toEqual(state)
})

test('invalid import code is rejected', () => {
  expect(() => importTracker('not-a-code')).toThrow(/invalid/i)
})

test('removeEntry removes only the matching cycle', () => {
  const state = upsertEntry({ version: 1, entries: [] }, entry)
  expect(removeEntry(state, entry.programId, entry.cycleId).entries).toHaveLength(0)
})
```

```ts
// tests/e2e/tracker.spec.ts
import { expect, test } from '@playwright/test'

test('saved listing appears in My Applications and can be exported', async ({ page }) => {
  await page.goto('/listing/chevening-pakistan/')
  await page.getByRole('button', { name: /save/i }).click()
  await page.goto('/my-applications/')
  await expect(page.getByTestId('tracker-entry')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /export/i })).toBeVisible()
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/tracker.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Implement the library with versioned storage key `scholarship-tracker:v1`. Add the
My Applications page: joins tracker entries with the index, shows status, note,
deadline countdown, remove, and export/import controls with an error message on
invalid codes. Empty state explains how to save a listing.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/tracker.test.ts` → PASS.
Run: `npx playwright test tests/e2e/tracker.spec.ts` → PASS.

- [ ] **Step 5: Commit**

`feat: add on-device application tracker`

---

### Task 12: About, 404, metadata, sitemap

**Files:**
- Create: `src/pages/about.astro`, `src/pages/404.astro`, `public/robots.txt`, `tests/e2e/meta.spec.ts`
- Modify: `astro.config.mjs` (sitemap integration), `src/layouts/BaseLayout.astro` (OG/meta)

**Interfaces:**
- Produces: per-page `<title>`, description, canonical, OG tags; sitemap at
  `/sitemap-index.xml`; robots pointing to it.

- [ ] **Step 1: Write the failing E2E test**

```ts
// tests/e2e/meta.spec.ts
import { expect, test } from '@playwright/test'

test('home has title, description, and OG tags', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/scholarship/i)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /scholarship/i)
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
})

test('about page carries the sourcing disclaimer', async ({ page }) => {
  await page.goto('/about/')
  await expect(page.getByText(/official sources/i)).toBeVisible()
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/meta.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

Add the About page (how it works, sourcing, verification, privacy, disclaimer,
"don't share personal details with the assistant"), a useful 404, metadata, sitemap
(install `@astrojs/sitemap`; set `site` in `astro.config.mjs` for absolute sitemap
URLs), and robots.

- [ ] **Step 4: Verify**

Run: `npx playwright test tests/e2e/meta.spec.ts` → PASS. `npm run build` → sitemap exists.

- [ ] **Step 5: Commit**

`feat: add about, 404, SEO metadata, and sitemap`

---

### Task 13: Freshness and sample-mode banner

**Files:**
- Create: `src/data/run-status.json`, `src/lib/freshness.ts`, `tests/unit/freshness.test.ts`
- Modify: `src/components/FreshnessBanner.astro`, `src/layouts/BaseLayout.astro`

**Interfaces:**
- Produces: `run-status.json { mode: 'sample'|'live'; lastSuccessfulRun: string|null }`;
  `freshnessState(status, now): 'sample'|'stale'|'fresh'` — stale when
  `lastSuccessfulRun` is null or older than 36 hours.
- Copy: sample → "Demo data — automated updates are not connected yet."; stale →
  "Data last updated <relative> — refresh may be delayed."

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/freshness.test.ts
import { expect, test } from 'vitest'
import { freshnessState } from '../../src/lib/freshness'

test('sample mode wins', () => {
  expect(freshnessState({ mode: 'sample', lastSuccessfulRun: null }, new Date())).toBe('sample')
})

test('older than 36 hours is stale', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: '2026-11-25T20:00:00Z' }, now)).toBe('stale')
})

test('recent success is fresh', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: '2026-11-27T03:00:00Z' }, now)).toBe('fresh')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/freshness.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Add the banner to BaseLayout. In sample mode it is always visible. In live mode it
appears only when stale. Keep it dismissible per session.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/unit/freshness.test.ts` → PASS. `npx playwright test` → PASS.

- [ ] **Step 5: Commit**

`feat: add freshness and demo-data banner`

---

### Task 14: Accessibility and performance budgets

**Files:**
- Create: `tests/e2e/a11y.spec.ts`, `tests/unit/index-size.test.ts`
- Modify: components as needed for violations

**Interfaces:**
- Produces: automated a11y checks on home, listing, archive, tracker; index size
  budget test.

- [ ] **Step 1: Write the failing checks**

```ts
// tests/e2e/a11y.spec.ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const path of ['/', '/listing/chevening-pakistan/', '/archive/', '/my-applications/']) {
  test(`no serious axe violations on ${path}`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact!))).toEqual([])
  })
}
```

```ts
// tests/unit/index-size.test.ts
import { gzipSync } from 'node:zlib'
import { expect, test } from 'vitest'
import { toIndexEntry } from '../../src/lib/filters'
import { loadPrograms } from '../../src/lib/data'

test('2,000-listing index stays under 300 KB gzipped', () => {
  const base = loadPrograms().map(toIndexEntry)
  const entries = Array.from({ length: 2000 }, (_, i) => ({ ...base[i % base.length], programId: `p-${i}`, slug: `p-${i}` }))
  expect(gzipSync(Buffer.from(JSON.stringify(entries))).byteLength).toBeLessThan(300 * 1024)
})
```

- [ ] **Step 2: Run and confirm failure or violations**

Run: `npx playwright test tests/e2e/a11y.spec.ts` and
`npx vitest run tests/unit/index-size.test.ts`.
Expected: at least one failure/violation to fix (if all pass, record that and move on).

- [ ] **Step 3: Fix**

Fix contrast, labels, landmarks, focus order, tap targets, and horizontal overflow
at 375×667. Trim index fields if the size budget fails (never add data the card
does not use).

- [ ] **Step 4: Verify**

Both commands → PASS. `npm run build` → PASS.

- [ ] **Step 5: Commit**

`test: enforce accessibility and index-size budgets`

---

### Task 15: Deployment and runbook

**Files:**
- Create: `docs/runbook.md`
- Modify: `README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: documented Cloudflare Pages setup (build `npm run build`, output `dist`),
  preview/production behavior, rollback via deployments, and a manual verification
  checklist.

- [ ] **Step 1: Write the deployment checklist (as the test)**

In `docs/runbook.md`, list exact steps and expected outcomes:
1. Connect the GitHub repo to Cloudflare Pages (free plan).
2. Build command `npm run build`; output `dist`; Node current LTS.
3. First deploy succeeds; `/` returns 200 and shows the demo banner.
4. A second push produces a preview deployment.
5. Rollback: select the previous deployment in Cloudflare and promote it.

- [ ] **Step 2: Perform the checklist**

Run the steps manually (or record them for the owner). Expected: production URL
loads, demo banner visible, listing pages reachable, no console errors.

- [ ] **Step 3: Update README**

README: what the project is, local dev commands, test commands, deploy summary,
where data lives, and a pointer to the runbook.

- [ ] **Step 4: Final verification**

Run: `npm run typecheck && npm test && npm run build && npm run test:e2e` → all PASS.

- [ ] **Step 5: Commit**

`docs: add deployment runbook and project README`

---

## Self-Review

**Spec coverage (Plan 1 scope):**

- Daily auto-updated listings → data shape and status-driven selectors (Tasks 2–3);
  the actual pipeline is Plan 2
- Level filter / eligible-only / sorting → Tasks 4, 5, 8
- Listing guide with verification rules → Tasks 6, 9
- Archive → Task 10
- On-device tracker → Task 11
- Report issue, share, freshness banner → Tasks 9, 13
- Admin site → Plan 3 (not in this plan)
- AI assistant → Plan 4 (not in this plan)
- Design research requirement → Task 7
- Accessibility/performance budgets → Task 14
- $0 deployment → Task 15

**Step scan:** every task has a failing test (or checklist) first, an implementation
step, a verification command, and a commit. No "TBD" steps.

**Type consistency:** `Program`/`Cycle` are defined once in `schema.ts` and used by
`data.ts`, `eligibility.ts`, `filters.ts`, and pages. `ProgramIndexEntry` is produced
by `toIndexEntry` and consumed by home/archive/tracker scripts. `StudyLevel` and
`VerificationStatus` come from `constants.ts` everywhere.

**Review Focus coverage:** partial data (Tasks 2, 6, 9), multi-cycle (Tasks 3, 9, 10),
level edge cases (Task 4), corrupted storage/import (Task 11), empty results and
null deadlines (Tasks 5, 8).
