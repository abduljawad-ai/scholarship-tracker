import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import type { Program } from '../../src/lib/schema'
import { loadConfig } from '../../scripts/pipeline/config'
import type { FetchLike } from '../../scripts/pipeline/http'
import { parseArgs } from '../../scripts/pipeline/main'
import { renderSummary } from '../../scripts/pipeline/report'
import { ProvidersExhaustedError } from '../../scripts/pipeline/router'
import { runPipeline, type RunOptions, type RunResult } from '../../scripts/pipeline/run'
import {
  createFileStore,
  createMemoryStore,
  emptyState,
  itemKey,
} from '../../scripts/pipeline/state'
import type {
  AiRequest,
  Extraction,
  PipelineConfig,
  Router,
  SourceConfig,
} from '../../scripts/pipeline/types'

const NOW = new Date('2026-11-27T06:00:00.000Z')
const LATER = new Date('2026-11-28T06:00:00.000Z')
const PAGE_URL = 'https://example.org/scholarships/'
const APPLY_URL = 'https://example.org/apply/'
const DEADLINE = '2027-12-01'
const KEY = itemKey('example', PAGE_URL)
const DISCOVERY_INDEX_URL = 'https://example.org/discover/'
const DISCOVERY_PAGE_URL = 'https://example.org/scholarships/new-program/'

const LONG_BODY = 'The scholarship covers tuition, a monthly stipend, and travel. '.repeat(12)
const PAGE_HTML = `<!doctype html><html><body>
<h1>Example Scholarship 2027/28</h1>
<p>Applications open on 1 August 2027 and close on 1 December 2027.</p>
<p>Apply at https://example.org/apply/ before the deadline.</p>
<p>${LONG_BODY}</p>
</body></html>`

function extractionFixture(): Extraction {
  return {
    pageKind: 'program',
    cycles: [
      {
        label: '2027/28 intake',
        status: null,
        dates: {
          opens: '2027-08-01',
          deadline: DEADLINE,
          resultsDate: null,
          studyStart: null,
        },
        apply: { url: APPLY_URL, portalName: 'Example portal', fee: null },
        evidence: [
          {
            field: 'opens',
            quote: 'Applications open on 1 August 2027',
            sourceUrl: PAGE_URL,
          },
          {
            field: 'deadline',
            quote: 'close on 1 December 2027',
            sourceUrl: PAGE_URL,
          },
          {
            field: 'applyUrl',
            quote: 'Apply at https://example.org/apply/',
            sourceUrl: PAGE_URL,
          },
        ],
      },
    ],
    guide: null,
  }
}

function programJson(id: string, pageUrl = PAGE_URL): Program {
  return {
    programId: id,
    title: `Program ${id}`,
    provider: 'Example Provider',
    providerType: 'gov',
    country: 'Pakistan',
    officialUrl: 'https://example.org/',
    fundedLevels: ['master'],
    applicantStages: ['bachelor'],
    fields: ['All subjects'],
    eligibility: {
      nationalities: ['PK'],
      ageMax: null,
      minDegree: null,
      minMarks: null,
      englishTest: null,
      experienceYears: null,
      other: [],
    },
    funding: {
      type: 'fully-funded',
      tuitionCovered: true,
      monthlyStipend: null,
      currency: null,
      otherBenefits: [],
    },
    guide: { steps: [], documents: [], tips: [], timeline: [] },
    cycles: [
      {
        cycleId: '2027',
        label: '2027/28 intake',
        dates: {
          opens: '2027-08-01',
          deadline: '2027-11-03',
          resultsDate: null,
          studyStart: null,
        },
        status: 'upcoming',
        apply: { url: null, portalName: null, fee: null },
        verification: {
          deadline: 'provisional',
          applyUrl: 'unverified',
          funding: 'unverified',
          eligibility: 'unverified',
        },
        sources: [{ url: pageUrl, type: 'official-page', lastVerified: '2026-11-20' }],
        evidence: [],
        confidence: 0,
      },
    ],
    firstSeen: '2026-11-18T00:00:00.000Z',
    lastUpdated: '2026-11-20T00:00:00.000Z',
  }
}

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    sourceId: 'example',
    programId: 'example-program',
    provider: 'Example Provider',
    officialHosts: ['example.org'],
    pageUrls: [PAGE_URL],
    indexUrls: [],
    discovery: false,
    archived: false,
    mode: 'extract',
    ...overrides,
  }
}

interface Fixture {
  root: string
  config: PipelineConfig
  dataDir: string
  statePath: string
  runStatusPath: string
  reportsDir: string
}

function fixture(
  sources: SourceConfig[] = [source()],
  programs: Program[] = [programJson('example-program')],
): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'pipeline-run-'))
  const dataDir = path.join(root, 'src/data/programs')
  const promptsDir = path.join(root, 'pipeline/prompts')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(promptsDir, { recursive: true })

  for (const program of programs) {
    writeFileSync(path.join(dataDir, `${program.programId}.json`), JSON.stringify(program, null, 2))
  }
  writeFileSync(path.join(root, 'pipeline/sources.json'), JSON.stringify(sources, null, 2))
  for (const prompt of ['extract.md', 'verify.md', 'discover.md', 'discover-gaps.md']) {
    copyFileSync(path.resolve('pipeline/prompts', prompt), path.join(promptsDir, prompt))
  }

  const runStatusPath = path.join(root, 'src/data/run-status.json')
  writeFileSync(runStatusPath, JSON.stringify({ mode: 'sample', lastSuccessfulRun: null }))

  const config = loadConfig({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }, root)
  return { root, config, dataDir, statePath: config.statePath, runStatusPath, reportsDir: config.reportsDir }
}

function fakeFetch(
  html = PAGE_HTML,
  options: { status?: number } = {},
): FetchLike {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (options.status !== undefined && options.status >= 400) {
      return new Response('error', {
        status: options.status,
        headers: { 'content-type': 'text/html' },
      })
    }
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  })
}

interface FakeRouter {
  router: Router
  complete: ReturnType<typeof vi.fn>
}

function fakeRouter(
  options: {
    extraction?: Extraction
    fail?: Error
    verify?: 'verified' | 'provisional'
    discoveryPageUrl?: string
  } = {},
): FakeRouter {
  const extraction = options.extraction ?? extractionFixture()
  const discoveryPageUrl = options.discoveryPageUrl ?? PAGE_URL

  const complete = vi.fn(async (request: AiRequest) => {
    if (request.task === 'extract' || request.task === 'extract-long') {
      if (options.fail) throw options.fail
      return { text: JSON.stringify(extraction), providerId: 'groq', model: 'test-model' }
    }

    if (request.task === 'discover') {
      if (request.system.includes('propose')) {
        return {
          text: JSON.stringify({ queries: [] }),
          providerId: 'groq',
          model: 'test-model',
        }
      }

      const urls = [...request.user.matchAll(/^URL: (.+)$/gm)].map((match) => match[1]!.trim())
      const pages = urls.map((url) => ({
        url,
        isScholarship: url === discoveryPageUrl,
        title: url === discoveryPageUrl ? 'Example Scholarship 2027' : null,
        provider: url === discoveryPageUrl ? 'Example Provider' : null,
        country: url === discoveryPageUrl ? 'Pakistan' : null,
        deadline: url === discoveryPageUrl ? DEADLINE : null,
        applyUrl: url === discoveryPageUrl ? APPLY_URL : null,
        evidence:
          url === discoveryPageUrl
            ? [
                { field: 'title', quote: 'Example Scholarship 2027', sourceUrl: url },
                { field: 'deadline', quote: 'close on 1 December 2027', sourceUrl: url },
                { field: 'applyUrl', quote: 'Apply at https://example.org/apply/', sourceUrl: url },
              ]
            : [],
      }))

      return {
        text: JSON.stringify({ pages }),
        providerId: 'groq',
        model: 'test-model',
      }
    }

    if (options.verify === 'provisional') {
      return {
        text: JSON.stringify({ agreed: false, quote: null, reason: 'not supported' }),
        providerId: 'gemini',
        model: 'test-model',
      }
    }

    const field = /Field: (\w+)/.exec(request.user)?.[1] ?? 'deadline'
    const quotes: Record<string, string> = {
      opens: 'Applications open on 1 August 2027',
      deadline: 'close on 1 December 2027',
      applyUrl: 'Apply at https://example.org/apply/',
    }

    return {
      text: JSON.stringify({ agreed: true, quote: quotes[field], reason: 'supported' }),
      providerId: 'gemini',
      model: 'test-model',
    }
  })

  return {
    router: { available: () => ['gemini'], complete: complete as unknown as Router['complete'] },
    complete,
  }
}

async function run(f: Fixture, options: Partial<RunOptions> = {}): Promise<RunResult> {
  const {
    store = createMemoryStore(),
    router = fakeRouter().router,
    fetchImpl = fakeFetch(),
    now = NOW,
    dryRun = false,
    maxItems = 20,
    allowLive = true,
    sourceId,
  } = options

  return runPipeline({
    config: f.config,
    router,
    store,
    fetchImpl,
    now,
    dryRun,
    maxItems,
    allowLive,
    sourceId,
    sleep: async () => {},
  })
}

function readProgram(f: Fixture, id = 'example-program'): Program {
  return JSON.parse(readFileSync(path.join(f.dataDir, `${id}.json`), 'utf8')) as Program
}

function readRunStatus(f: Fixture): { mode: string; lastSuccessfulRun: string | null } {
  return JSON.parse(readFileSync(f.runStatusPath, 'utf8'))
}

test('a successful item publishes the program and goes live', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fake = fakeRouter()

  const result = await run(f, { store, router: fake.router })

  expect(result.summary.status).toBe('complete')
  expect(result.summary.published).toEqual(['example-program'])
  expect(store.get().run?.items[KEY]?.state).toBe('published')

  const program = readProgram(f)
  expect(program.cycles[0]!.dates.deadline).toBe(DEADLINE)
  expect(program.cycles[0]!.verification.deadline).toBe('verified')
  expect(program.cycles[0]!.apply.url).toBe(APPLY_URL)
  expect(program.cycles[0]!.verification.applyUrl).toBe('verified')
  expect(readRunStatus(f).mode).toBe('live')
})

test('an unchanged run skips extraction and refreshes lastSuccessfulRun', async () => {
  const f = fixture()
  const store = createMemoryStore()
  await run(f, { store })

  const second = fakeRouter()
  const result = await run(f, { store, router: second.router, now: LATER })

  expect(second.complete).not.toHaveBeenCalled()
  expect(result.summary.status).toBe('complete')
  expect(result.summary.unchanged).toEqual(['example-program'])
  expect(readRunStatus(f)).toEqual({ mode: 'live', lastSuccessfulRun: LATER.toISOString() })
})

test('a provider pause still checks monitor sources first', async () => {
  const f = fixture([
    source(),
    source({
      sourceId: 'watch',
      programId: 'example-program',
      pageUrls: ['https://example.org/watch/'],
      mode: 'monitor',
    }),
  ])
  const store = createMemoryStore()

  const result = await run(f, {
    store,
    router: fakeRouter({ fail: new ProvidersExhaustedError('no provider') }).router,
  })

  expect(result.summary.status).toBe('paused')
  expect(store.get().pages[itemKey('watch', 'https://example.org/watch/')]).toBeDefined()
})

test('a monitor source records a change for review without extracting', async () => {
  const f = fixture([source({ mode: 'monitor' })])
  const store = createMemoryStore()
  const first = fakeRouter()

  const initial = await run(f, { store, router: first.router })

  expect(first.complete).not.toHaveBeenCalled()
  expect(initial.summary.status).toBe('complete')
  expect(initial.summary.review).toEqual([])
  expect(initial.summary.unchanged).toEqual(['example-program'])
  expect(readProgram(f).cycles[0]!.dates.deadline).toBe('2027-11-03')

  const changed = PAGE_HTML.replace('Example Scholarship 2027/28', 'Example Scholarship 2028/29')
  const second = fakeRouter()
  const result = await run(f, {
    store,
    router: second.router,
    fetchImpl: fakeFetch(changed),
    now: LATER,
  })

  expect(second.complete).not.toHaveBeenCalled()
  expect(result.summary.status).toBe('complete')
  expect(result.summary.review).toEqual([PAGE_URL])
  expect(result.report.review[0]).toMatchObject({ sourceId: 'example', url: PAGE_URL })
  expect(readProgram(f).cycles[0]!.dates.deadline).toBe('2027-11-03')
})

test('a failed item does not stop a good source but blocks live mode', async () => {
  const good = source()
  const bad = source({
    sourceId: 'bad',
    programId: 'bad-program',
    pageUrls: ['https://example.org/bad/'],
  })
  const f = fixture(
    [good, bad],
    [programJson('example-program'), programJson('bad-program', 'https://example.org/bad/')],
  )

  const fetchImpl = vi.fn<FetchLike>(async (url) => {
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (url.includes('/bad/')) {
      return new Response('nope', { status: 500, headers: { 'content-type': 'text/html' } })
    }
    return new Response(PAGE_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
  })

  const result = await run(f, { fetchImpl })

  expect(result.summary.published).toEqual(['example-program'])
  expect(result.summary.failed).toEqual(['bad::https://example.org/bad/'])
  expect(result.report.sources.example?.published).toBe(1)
  expect(result.report.sources.bad?.failed).toBe(1)
  expect(readRunStatus(f).mode).toBe('sample')
})

test('dryRun writes no program, state, or run-status', async () => {
  const f = fixture()
  const programPath = path.join(f.dataDir, 'example-program.json')
  const originalProgram = readFileSync(programPath, 'utf8')
  const originalStatus = readFileSync(f.runStatusPath, 'utf8')

  const result = await run(f, { store: createFileStore(f.statePath), dryRun: true })

  expect(result.summary.published).toEqual(['example-program'])
  expect(readFileSync(programPath, 'utf8')).toBe(originalProgram)
  expect(readFileSync(f.runStatusPath, 'utf8')).toBe(originalStatus)
  expect(existsSync(f.statePath)).toBe(false)
  expect(existsSync(f.reportsDir)).toBe(false)
})

test('provider exhaustion pauses the run and the next run resumes', async () => {
  const f = fixture()
  const store = createMemoryStore()

  const first = await run(f, {
    store,
    router: fakeRouter({ fail: new ProvidersExhaustedError('quota exhausted') }).router,
  })

  expect(first.summary.status).toBe('paused')
  expect(store.get().run?.status).toBe('paused')
  expect(store.get().run?.items[KEY]?.state).toBe('pending')
  expect(readRunStatus(f).mode).toBe('sample')

  const second = await run(f, {
    store,
    router: fakeRouter().router,
    now: new Date('2026-11-27T07:00:00.000Z'),
  })

  expect(second.summary.status).toBe('complete')
  expect(second.summary.published).toEqual(['example-program'])
  expect(readProgram(f).cycles[0]!.dates.deadline).toBe(DEADLINE)
  expect(readRunStatus(f).mode).toBe('live')
})

test('an invalid extraction is retried until the item is dead', async () => {
  const f = fixture()
  const store = createMemoryStore()

  const bad = extractionFixture()
  bad.cycles[0]!.evidence = bad.cycles[0]!.evidence.filter((item) => item.field !== 'deadline')
  const fake = fakeRouter({ extraction: bad })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await run(f, {
      store,
      router: fake.router,
      now: new Date(NOW.getTime() + attempt * 86_400_000),
    })
  }

  const item = store.get().run?.items[KEY]
  expect(item?.state).toBe('dead')
  expect(item?.attempts).toBe(3)
})

test('an archived source is skipped', async () => {
  const archived = source({
    sourceId: 'old',
    programId: 'old-program',
    pageUrls: ['https://example.org/old/'],
    archived: true,
  })
  const f = fixture(
    [source(), archived],
    [programJson('example-program'), programJson('old-program', 'https://example.org/old/')],
  )
  const fetchImpl = fakeFetch()

  const result = await run(f, { fetchImpl })

  expect(result.summary.published).toEqual(['example-program'])
  expect(result.report.skipped).toEqual([])
  expect(result.summary.unhealthy).toEqual([])
  expect(readProgram(f, 'old-program').cycles[0]!.dates.deadline).toBe('2027-11-03')
  expect(fetchImpl).not.toHaveBeenCalledWith(
    'https://example.org/old/',
    expect.anything(),
  )
})

test('a short page is suspicious and keeps the last good data', async () => {
  const f = fixture()
  const store = createMemoryStore()
  await run(f, { store })
  const goodDeadline = readProgram(f).cycles[0]!.dates.deadline

  const result = await run(f, {
    store,
    fetchImpl: fakeFetch('<html><body><p>Too short.</p></body></html>'),
    now: LATER,
  })

  expect(result.summary.published).toEqual([])
  expect(result.summary.failed).toEqual([KEY])
  expect(readProgram(f).cycles[0]!.dates.deadline).toBe(goodDeadline)
  expect(store.get().sources.example?.failures).toBe(1)
  expect(store.get().pages[KEY]?.textLength).toBeGreaterThan(400)
})

test('five consecutive fetch failures retire a source and block live mode', async () => {
  const f = fixture([source()])
  const store = createMemoryStore()
  const failingFetch = fakeFetch('', { status: 500 })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await run(f, {
      store,
      fetchImpl: failingFetch,
      now: new Date(NOW.getTime() + attempt * 86_400_000),
    })
  }

  expect(store.get().sources.example?.failures).toBe(5)
  expect(store.get().sources.example?.retired).toBe(true)
  expect(readRunStatus(f).mode).toBe('sample')

  const second = await run(f, { store, fetchImpl: fakeFetch(), now: LATER })

  expect(second.summary.unhealthy).toEqual(['example'])
  expect(second.summary.checked).toBe(0)
  expect(readRunStatus(f).mode).toBe('sample')
})

test('a source inside its backoff window is skipped', async () => {
  const f = fixture()
  const store = createMemoryStore()
  store.set({
    ...emptyState(),
    sources: {
      example: {
        lastFetchedAt: '2026-11-27T00:00:00.000Z',
        failures: 1,
        retired: false,
        nextEligibleAt: '2026-11-27T07:00:00.000Z',
      },
    },
  })
  const fetchImpl = fakeFetch()

  const result = await run(f, { store, fetchImpl })

  expect(result.summary.unhealthy).toEqual(['example'])
  expect(result.summary.checked).toBe(0)
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(readRunStatus(f).mode).toBe('sample')
})

test('the report is written and the summary counts both outcomes', async () => {
  const bad = source({
    sourceId: 'bad',
    programId: 'bad-program',
    pageUrls: ['https://example.org/bad/'],
  })
  const f = fixture(
    [source(), bad],
    [programJson('example-program'), programJson('bad-program', 'https://example.org/bad/')],
  )

  const result = await run(f)

  const reportPath = path.join(f.reportsDir, `${result.summary.runId}.json`)
  expect(existsSync(reportPath)).toBe(true)

  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  expect(report.published).toEqual(['example-program'])
  expect(report.failed).toHaveLength(1)
  expect(report.checked).toBe(2)

  const markdown = renderSummary(result.report)
  expect(markdown).toContain('Published: 1')
  expect(markdown).toContain('Failed: 1')
})

test('discovery queues a candidate without touching published programs', async () => {
  const discoverySource = source({
    sourceId: 'discovery',
    programId: null,
    pageUrls: [DISCOVERY_INDEX_URL],
    indexUrls: [DISCOVERY_INDEX_URL],
    discovery: true,
  })
  const f = fixture([discoverySource], [programJson('example-program')])
  const programBefore = readFileSync(path.join(f.dataDir, 'example-program.json'), 'utf8')

  const fetchImpl = vi.fn<FetchLike>(async (url) => {
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (url === 'https://example.org/sitemap.xml') {
      return new Response(`<urlset><url><loc>${DISCOVERY_PAGE_URL}</loc></url></urlset>`, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    }
    if (url === DISCOVERY_INDEX_URL) {
      return new Response(
        `<html><body><a href="${DISCOVERY_PAGE_URL}">New program</a></body></html>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      )
    }
    if (url === DISCOVERY_PAGE_URL) {
      return new Response(PAGE_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    return new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    })
  })

  const result = await run(f, {
    fetchImpl,
    router: fakeRouter({ discoveryPageUrl: DISCOVERY_PAGE_URL }).router,
  })

  expect(result.summary.status).toBe('complete')
  expect(result.summary.candidates).toBe(1)
  expect(result.report.candidates).toBe(1)
  expect(result.report.discovery?.accepted).toBe(1)
  expect(result.report.discovery?.stopReason).toBe('no-signal')

  const queue = JSON.parse(readFileSync(f.config.candidatesPath, 'utf8')) as {
    candidates: Array<{ officialUrl: string; status: string }>
  }
  expect(queue.candidates).toHaveLength(1)
  expect(queue.candidates[0]?.officialUrl).toBe(DISCOVERY_PAGE_URL)
  expect(queue.candidates[0]?.status).toBe('pending-review')
  expect(readFileSync(path.join(f.dataDir, 'example-program.json'), 'utf8')).toBe(programBefore)
})

test('parseArgs reads defaults and flags and rejects unknown options', () => {
  expect(parseArgs([])).toEqual({
    maxItems: 20,
    sourceId: undefined,
    dryRun: false,
    live: false,
    discovery: true,
  })
  expect(parseArgs(['--max-items', '5', '--source', 'chevening', '--dry-run', '--live'])).toEqual({
    maxItems: 5,
    sourceId: 'chevening',
    dryRun: true,
    live: true,
    discovery: true,
  })
  expect(parseArgs(['--no-discovery']).discovery).toBe(false)
  expect(() => parseArgs(['--unknown'])).toThrow()
  expect(() => parseArgs(['--max-items', '0'])).toThrow(/positive integer/)
})
