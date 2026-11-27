import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { loadConfig } from '../../scripts/pipeline/config'
import {
  extractFeedLinks,
  extractSitemapLinks,
  loadCandidates,
  mergeCandidates,
  parseCandidates,
  parseDiscoveryResponse,
  parseGapResponse,
  runDiscovery,
  saveCandidates,
  scoreFrontier,
} from '../../scripts/pipeline/discover'
import type { FetchLike } from '../../scripts/pipeline/http'
import { createMemoryStore } from '../../scripts/pipeline/state'
import type {
  AiRequest,
  Candidate,
  PipelineConfig,
  Router,
  SourceConfig,
} from '../../scripts/pipeline/types'
import { normalizeUrl } from '../../scripts/pipeline/text'

const NOW = new Date('2026-11-27T06:00:00.000Z')
const SITE = 'https://example.org'
const SITEMAP_URL = `${SITE}/sitemap.xml`
const CHILD_SITEMAP_URL = `${SITE}/sitemap-scholarships.xml`
const INDEX_URL = `${SITE}/admissions/`
const FEED_URL = `${SITE}/feed.xml`
const PAGE_URL = `${SITE}/scholarships/example-scholarship/`
const CHILD_PAGE_URL = `${SITE}/funding/another-scholarship/`
const NEWS_URL = `${SITE}/news/graduation/`
const OFF_HOST_URL = 'https://other.example.net/scholarships/fake/'
const MEDIA_URL = `${SITE}/media/logo.jpg`

const LONG_BODY = 'The scholarship covers tuition, a monthly stipend, travel, and health cover. '.repeat(10)

const PAGE_HTML = `<!doctype html><html><head><title>Example Scholarship 2027</title></head><body>
<h1>Example Scholarship 2027</h1>
<p>Applications close on 1 December 2027.</p>
<p>Apply at https://example.org/apply/ before the deadline.</p>
<p>${LONG_BODY}</p>
</body></html>`

const OTHER_PAGE_HTML = `<!doctype html><html><head><title>Another Scholarship</title></head><body>
<h1>Another Scholarship</h1>
<p>Applications close on 5 January 2028.</p>
<p>${LONG_BODY}</p>
</body></html>`

const NEWS_HTML = `<!doctype html><html><head><title>Graduation news</title></head><body>
<h1>Graduation news</h1><p>${LONG_BODY}</p>
</body></html>`

const INDEX_HTML = `<!doctype html><html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
</head><body>
<a href="/scholarships/example-scholarship/">Example Scholarship</a>
<a href="/news/graduation/">Graduation news</a>
<a href="${OFF_HOST_URL}">Off host</a>
<a href="/media/logo.jpg">Logo</a>
</body></html>`

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex><sitemap><loc>${CHILD_SITEMAP_URL}</loc></sitemap></sitemapindex>`

const CHILD_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
<url><loc>${PAGE_URL}</loc><lastmod>2026-11-20</lastmod></url>
<url><loc>${CHILD_PAGE_URL}</loc></url>
<url><loc>${NEWS_URL}</loc></url>
<url><loc>${MEDIA_URL}</loc></url>
<url><loc>${OFF_HOST_URL}</loc></url>
</urlset>`

const FEED = `<?xml version="1.0"?>
<rss><channel><item><link>${PAGE_URL}</link></item></channel></rss>`

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    sourceId: 'example',
    programId: null,
    provider: 'Example Foundation',
    officialHosts: ['example.org'],
    pageUrls: [],
    indexUrls: [INDEX_URL],
    discovery: true,
    archived: false,
    ...overrides,
  }
}

interface Fixture {
  root: string
  config: PipelineConfig
  dataDir: string
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'pipeline-discover-'))
  const promptsDir = path.join(root, 'pipeline/prompts')
  const dataDir = path.join(root, 'src/data/programs')
  mkdirSync(promptsDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  for (const prompt of ['discover.md', 'discover-gaps.md']) {
    copyFileSync(path.resolve('pipeline/prompts', prompt), path.join(promptsDir, prompt))
  }

  writeFileSync(path.join(root, 'pipeline/sources.json'), JSON.stringify([source()], null, 2))
  writeFileSync(path.join(root, 'pipeline/candidates.json'), JSON.stringify({ version: 1, candidates: [] }))

  return { root, config: loadConfig({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }, root), dataDir }
}

interface FetchOptions {
  onPage?: (url: string) => void
}

function fakeFetch(options: FetchOptions = {}): FetchLike {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (url === SITEMAP_URL) {
      return new Response(SITEMAP_INDEX, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    }
    if (url === CHILD_SITEMAP_URL) {
      return new Response(CHILD_SITEMAP, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    }
    if (url === INDEX_URL) {
      return new Response(INDEX_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    if (url === FEED_URL) {
      return new Response(FEED, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      })
    }
    if (url === PAGE_URL) {
      options.onPage?.(url)
      return new Response(PAGE_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    if (url === CHILD_PAGE_URL) {
      options.onPage?.(url)
      return new Response(OTHER_PAGE_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    if (url === NEWS_URL) {
      options.onPage?.(url)
      return new Response(NEWS_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  })
}

function pageDraft(url: string): Record<string, unknown> {
  if (url === PAGE_URL) {
    return {
      url,
      isScholarship: true,
      title: 'Example Scholarship 2027',
      provider: 'Example Foundation',
      country: 'Pakistan',
      deadline: '2027-12-01',
      applyUrl: 'https://example.org/apply/',
      evidence: [
        { field: 'title', quote: 'Example Scholarship 2027', sourceUrl: url },
        { field: 'deadline', quote: 'Applications close on 1 December 2027.', sourceUrl: url },
        { field: 'applyUrl', quote: 'Apply at https://example.org/apply/', sourceUrl: url },
      ],
    }
  }
  if (url === CHILD_PAGE_URL) {
    return {
      url,
      isScholarship: false,
      title: null,
      provider: null,
      country: null,
      deadline: null,
      applyUrl: null,
      evidence: [],
    }
  }
  return {
    url,
    isScholarship: false,
    title: null,
    provider: null,
    country: null,
    deadline: null,
    applyUrl: null,
    evidence: [],
  }
}

interface FakeRouter {
  router: Router
  classify: ReturnType<typeof vi.fn>
  gaps: ReturnType<typeof vi.fn>
}

function fakeRouter(options: { pages?: (url: string) => Record<string, unknown> } = {}): FakeRouter {
  const classify = vi.fn(async (request: AiRequest) => {
    const urls = [...request.user.matchAll(/^URL: (.+)$/gm)].map((match) => match[1]!.trim())
    const pages = urls.map((url) => (options.pages ?? pageDraft)(url))
    return { text: JSON.stringify({ pages }), providerId: 'groq', model: 'test-model' }
  })

  const gaps = vi.fn(async () => ({
    text: JSON.stringify({ queries: ['Sindh merit scholarship'] }),
    providerId: 'groq',
    model: 'test-model',
  }))

  const complete = vi.fn(async (request: AiRequest) =>
    request.system.includes('propose') ? gaps() : classify(request),
  )

  return {
    router: {
      available: () => ['groq'],
      complete: complete as unknown as Router['complete'],
    },
    classify,
    gaps,
  }
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'example-scholarship-2027',
    title: 'Example Scholarship',
    provider: 'Example Foundation',
    country: 'Pakistan',
    officialUrl: 'https://example.org/scholarships/example/',
    deadline: '2027-12-01',
    applyUrl: null,
    evidence: [
      {
        field: 'title',
        quote: 'Example Scholarship',
        sourceUrl: 'https://example.org/scholarships/example/',
      },
    ],
    sourceId: 'example',
    discoveredAt: NOW.toISOString(),
    status: 'pending-review',
    ...overrides,
  }
}

test('normalizeUrl drops fragments, default ports, and trailing slashes', () => {
  expect(normalizeUrl('https://Example.org:443/a/#section')).toBe('https://example.org/a')
  expect(normalizeUrl('https://example.org/a/?b=1#c')).toBe('https://example.org/a/?b=1')
  expect(normalizeUrl('https://example.org/')).toBe('https://example.org')
})

test('extractSitemapLinks resolves relative URLs and keeps allowed hosts', () => {
  const xml = `<urlset>
    <url><loc>https://example.org/scholarships/</loc></url>
    <url><loc>/funding/</loc></url>
    <url><loc>https://other.example.net/scholarships/</loc></url>
  </urlset>`

  expect(extractSitemapLinks(xml, SITE, ['example.org'])).toEqual([
    'https://example.org/scholarships/',
    'https://example.org/funding/',
  ])
})

test('extractFeedLinks reads RSS links and Atom hrefs', () => {
  const rss = `<rss><channel><item><link>${PAGE_URL}</link></item></channel></rss>`
  const atom = `<feed><entry><link href="${CHILD_PAGE_URL}"/></entry></feed>`

  expect(extractFeedLinks(rss, SITE)).toEqual([PAGE_URL])
  expect(extractFeedLinks(atom, SITE)).toEqual([CHILD_PAGE_URL])
})

test('scoreFrontier prefers an official scholarship path over news and media', () => {
  const base = {
    allowedHosts: ['example.org'],
    discoveredVia: 'sitemap' as const,
    lastmod: null,
  }

  const scholarship = scoreFrontier({
    ...base,
    url: 'https://example.org/scholarships/example/',
    host: 'example.org',
  })
  const news = scoreFrontier({
    ...base,
    url: 'https://example.org/news/graduation/',
    host: 'example.org',
  })
  const media = scoreFrontier({
    ...base,
    url: 'https://example.org/media/logo.jpg',
    host: 'example.org',
  })
  const offHost = scoreFrontier({
    ...base,
    url: 'https://other.example.net/scholarships/fake/',
    host: 'other.example.net',
  })

  expect(scholarship).toBeGreaterThan(news)
  expect(news).toBeGreaterThan(media)
  expect(media).toBeLessThan(0)
  expect(offHost).toBeLessThan(0)
})

test('parseCandidates validates a candidates file and rejects malformed data', () => {
  const text = JSON.stringify({ version: 1, candidates: [candidate()] })

  expect(parseCandidates(text)).toEqual([candidate()])
  expect(() => parseCandidates('{')).toThrow(/JSON/)
  expect(() => parseCandidates(JSON.stringify([{ title: 'missing fields' }]))).toThrow(/schema/)
})

test('saveCandidates and loadCandidates round-trip atomically', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pipeline-candidates-'))
  const file = path.join(root, 'pipeline/candidates.json')

  saveCandidates(file, [candidate()])

  expect(readdirSync(path.dirname(file))).toEqual(['candidates.json'])
  expect(loadCandidates(file)).toEqual([candidate()])
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, candidates: [candidate()] })
  expect(loadCandidates(path.join(root, 'missing.json'))).toEqual([])
})

test('mergeCandidates dedupes by URL and title and respects the pending cap', () => {
  const existing = [candidate()]
  const duplicateUrl = candidate({
    candidateId: 'other-id',
    title: 'A different title',
    officialUrl: 'https://example.org/scholarships/example/#apply',
  })
  const duplicateTitle = candidate({
    candidateId: 'third-id',
    title: '  example scholarship ',
    officialUrl: 'https://example.org/scholarships/other/',
  })
  const fresh = candidate({
    candidateId: 'fresh-id',
    title: 'Fresh Scholarship',
    officialUrl: 'https://example.org/scholarships/fresh/',
  })

  const merged = mergeCandidates(existing, [duplicateUrl, duplicateTitle, fresh], 50)

  expect(merged.map((item) => item.candidateId)).toEqual(['example-scholarship-2027', 'fresh-id'])
  expect(mergeCandidates([], [fresh], 0)).toEqual([])
})

test('parseDiscoveryResponse maps pages and parseGapResponse reads queries', () => {
  const pages = parseDiscoveryResponse(
    JSON.stringify({ pages: [pageDraft(PAGE_URL)] }),
  )
  expect(pages[0]?.url).toBe(PAGE_URL)

  expect(parseGapResponse(JSON.stringify({ queries: ['Sindh merit scholarship'] }))).toEqual([
    'Sindh merit scholarship',
  ])
})

test('discovery fetches only official candidates and queues one review item', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fetched: string[] = []
  const fetchImpl = fakeFetch({ onPage: (url) => fetched.push(url) })
  const fake = fakeRouter()

  const result = await runDiscovery({
    config: f.config,
    router: fake.router,
    store,
    sources: [source()],
    fetchImpl,
    now: NOW,
    budgets: { maxRounds: 1 },
    sleep: async () => {},
  })

  expect(result.accepted).toHaveLength(1)
  expect(result.accepted[0]).toMatchObject({
    title: 'Example Scholarship 2027',
    provider: 'Example Foundation',
    officialUrl: PAGE_URL,
    deadline: '2027-12-01',
    applyUrl: 'https://example.org/apply/',
    status: 'pending-review',
    discoveredVia: 'sitemap',
  })
  expect(result.accepted[0]?.evidence.length).toBeGreaterThan(0)

  expect(fetched).toContain(PAGE_URL)
  expect(fetched).not.toContain(OFF_HOST_URL)
  expect(fetched).not.toContain(MEDIA_URL)
  expect(fetched).not.toContain(NEWS_URL)

  expect(loadCandidates(f.config.candidatesPath)).toHaveLength(1)
  expect(readdirSync(f.dataDir)).toEqual([])
  expect(store.get().discovery?.seenUrls[normalizeUrl(PAGE_URL)]).toBeTruthy()
  expect(store.get().discovery?.queries.length).toBeGreaterThan(0)
})

test('an unsupported quote is dropped and an unsafe apply URL becomes null', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fake = fakeRouter({
    pages: (url) => ({
      url,
      isScholarship: true,
      title: 'Example Scholarship 2027',
      provider: 'Example Foundation',
      country: 'Pakistan',
      deadline: '2027-12-01',
      applyUrl: 'https://evil.example/apply/',
      evidence: [
        { field: 'title', quote: 'Example Scholarship 2027', sourceUrl: url },
        { field: 'deadline', quote: 'Applications close on 9 September 2029.', sourceUrl: url },
        { field: 'applyUrl', quote: 'Apply at https://evil.example/apply/', sourceUrl: url },
      ],
    }),
  })

  const result = await runDiscovery({
    config: f.config,
    router: fake.router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch(),
    now: NOW,
    budgets: { maxRounds: 1, maxFetchesPerRun: 1, maxFetchesPerRound: 1 },
    sleep: async () => {},
  })

  expect(result.accepted).toHaveLength(1)
  expect(result.accepted[0]?.deadline).toBeNull()
  expect(result.accepted[0]?.applyUrl).toBeNull()
  expect(result.accepted[0]?.evidence.map((item) => item.field)).toEqual(['title'])
})

test('a second run does not refetch pages already seen', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const first = fakeRouter()
  await runDiscovery({
    config: f.config,
    router: first.router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch(),
    now: NOW,
    budgets: { maxRounds: 1 },
    sleep: async () => {},
  })

  const pageFetches: string[] = []
  const second = fakeRouter()
  const result = await runDiscovery({
    config: f.config,
    router: second.router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch({ onPage: (url) => pageFetches.push(url) }),
    now: new Date(NOW.getTime() + 86_400_000),
    budgets: { maxRounds: 1 },
    sleep: async () => {},
  })

  expect(pageFetches).toEqual([])
  expect(result.accepted).toEqual([])
  expect(loadCandidates(f.config.candidatesPath)).toHaveLength(1)
})

test('the loop stops at the fetch cap', async () => {
  const f = fixture()
  const store = createMemoryStore()

  const result = await runDiscovery({
    config: f.config,
    router: fakeRouter().router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch(),
    now: NOW,
    budgets: { maxRounds: 3, maxFetchesPerRun: 1, maxFetchesPerRound: 1 },
    sleep: async () => {},
  })

  expect(result.fetched).toBe(1)
  expect(result.stopReason).toBe('fetch-cap')
})

test('the loop stops at the round cap and asks for gaps only between rounds', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fake = fakeRouter()

  const result = await runDiscovery({
    config: f.config,
    router: fake.router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch(),
    now: NOW,
    budgets: { maxRounds: 1 },
    sleep: async () => {},
  })

  expect(result.rounds).toHaveLength(1)
  expect(fake.gaps).not.toHaveBeenCalled()
})

test('a rejected page triggers one gap query and a second round', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fake = fakeRouter()

  const result = await runDiscovery({
    config: f.config,
    router: fake.router,
    store,
    sources: [source()],
    fetchImpl: fakeFetch(),
    now: NOW,
    budgets: { maxRounds: 2 },
    sleep: async () => {},
  })

  expect(fake.gaps).toHaveBeenCalledTimes(1)
  expect(result.rounds).toHaveLength(2)
  expect(result.rounds[0]?.gaps).toEqual(['Sindh merit scholarship'])
  expect(result.stopReason).toBe('no-new-urls')
})

test('no provider means no discovery and no failure', async () => {
  const f = fixture()
  const store = createMemoryStore()
  const fetchImpl = fakeFetch()

  const result = await runDiscovery({
    config: f.config,
    router: { available: () => [], complete: vi.fn() } as unknown as Router,
    store,
    sources: [source()],
    fetchImpl,
    now: NOW,
    budgets: { maxRounds: 1 },
    sleep: async () => {},
  })

  expect(result.stopReason).toBe('no-provider')
  expect(result.fetched).toBe(0)
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(existsSync(f.config.candidatesPath)).toBe(true)
})
