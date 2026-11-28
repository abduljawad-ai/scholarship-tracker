import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { isPlausibleDeadline, quoteSupportsDate } from '../../scripts/pipeline/dates'
import { isAllowedApplyUrl, isAllowedHost, checkApplyUrl } from '../../scripts/pipeline/urls'
import { verifyFact, type VerifiableFact } from '../../scripts/pipeline/verify'
import type { FetchLike } from '../../scripts/pipeline/http'
import type { PageSnapshot, Router } from '../../scripts/pipeline/types'

const PAGE_URL = 'https://www.chevening.org/scholarships/'
const PROMPTS_DIR = path.resolve('pipeline/prompts')

const SNAPSHOT: PageSnapshot = {
  url: PAGE_URL,
  finalUrl: PAGE_URL,
  status: 200,
  contentType: 'text/html',
  hash: 'abc',
  text: [
    'Chevening Scholarships applications open on 1 August 2027 and close on 3 November 2027.',
    'Apply at https://www.chevening.org/scholarships/apply/ before the deadline.',
  ].join('\n'),
}

const DEADLINE_FACT: VerifiableFact = {
  field: 'deadline',
  value: '2027-11-03',
  quote: 'close on 3 November 2027',
  sourceUrl: PAGE_URL,
}

function fakeResponse(status: number, url: string): Response {
  return { status, url, headers: new Headers() } as Response
}

function fakeRouter(options: {
  available?: () => string[]
  complete?: ReturnType<typeof vi.fn>
} = {}): Router {
  return {
    available: (options.available ?? (() => ['gemini'])) as Router['available'],
    complete: (options.complete ??
      vi.fn(async () => ({
        text: JSON.stringify({
          agreed: true,
          quote: 'close on 3 November 2027',
          reason: 'The page states the deadline.',
        }),
        providerId: 'gemini',
        model: 'gemini-2.5-flash',
      }))) as Router['complete'],
  }
}

test('quoteSupportsDate accepts the common written forms', () => {
  for (const quote of [
    '3 November 2027',
    '3 Nov 2027',
    'November 3, 2027',
    '2027-11-03',
    '3rd November 2027',
  ]) {
    expect(quoteSupportsDate(quote, '2027-11-03'), quote).toBe(true)
  }
})

test('ambiguous numeric dates are not accepted', () => {
  expect(quoteSupportsDate('03/11/2027', '2027-11-03')).toBe(false)
})

test('an unambiguous numeric date is accepted', () => {
  expect(quoteSupportsDate('13/11/2027', '2027-11-13')).toBe(true)
})

test('a different year does not support the date', () => {
  expect(quoteSupportsDate('3 November 2028', '2027-11-03')).toBe(false)
})

test('a day embedded in a larger number does not match', () => {
  expect(quoteSupportsDate('13 November 2027', '2027-11-03')).toBe(false)
})

test('isPlausibleDeadline keeps deadlines within three years', () => {
  expect(isPlausibleDeadline('2027-11-03', '2026-11-27')).toBe(true)
  expect(isPlausibleDeadline('2026-11-26', '2026-11-27')).toBe(false)
  expect(isPlausibleDeadline('2030-01-01', '2026-11-27')).toBe(false)
})

test('exact hosts and subdomains are allowed; lookalikes are not', () => {
  expect(isAllowedHost('https://www.chevening.org/x', ['chevening.org'])).toBe(true)
  expect(isAllowedHost('https://apply.chevening.org/x', ['chevening.org'])).toBe(true)
  expect(isAllowedHost('https://chevening.org.evil.com/x', ['chevening.org'])).toBe(false)
  expect(isAllowedHost('http://www.chevening.org/x', ['chevening.org'])).toBe(true)
})

test('apply URLs must be HTTPS on an allowed host', () => {
  expect(isAllowedApplyUrl('https://apply.chevening.org/x', ['chevening.org'])).toBe(true)
  expect(isAllowedApplyUrl('http://www.chevening.org/x', ['chevening.org'])).toBe(false)
  expect(isAllowedApplyUrl('https://chevening.org.evil.com/x', ['chevening.org'])).toBe(false)
})

test('checkApplyUrl accepts a 200 on the same host', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    fakeResponse(200, 'https://www.chevening.org/scholarships/apply/'),
  )

  const result = await checkApplyUrl(
    'https://www.chevening.org/scholarships/apply/',
    ['chevening.org'],
    fetchImpl,
  )

  expect(result.ok).toBe(true)
  expect(result.finalUrl).toBe('https://www.chevening.org/scholarships/apply/')
})

test('checkApplyUrl accepts a redirect to an allowed subdomain', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => fakeResponse(200, 'https://apply.chevening.org/'))

  const result = await checkApplyUrl(
    'https://www.chevening.org/scholarships/apply/',
    ['chevening.org'],
    fetchImpl,
  )

  expect(result.ok).toBe(true)
})

test('checkApplyUrl rejects a redirect to another host', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => fakeResponse(200, 'https://evil.example/apply'))

  const result = await checkApplyUrl(
    'https://www.chevening.org/scholarships/apply/',
    ['chevening.org'],
    fetchImpl,
  )

  expect(result.ok).toBe(false)
  expect(result.reason).toMatch(/official host/i)
})

test('checkApplyUrl rejects a 404 and a network error', async () => {
  const notFound = vi.fn<FetchLike>(async () => fakeResponse(404, 'https://www.chevening.org/x'))
  const network = vi.fn<FetchLike>(async () => {
    throw new TypeError('connection refused')
  })

  await expect(
    checkApplyUrl('https://www.chevening.org/x', ['chevening.org'], notFound),
  ).resolves.toMatchObject({ ok: false })
  await expect(
    checkApplyUrl('https://www.chevening.org/x', ['chevening.org'], network),
  ).resolves.toMatchObject({ ok: false })
})

test('a fact whose quote is absent is provisional without calling the router', async () => {
  const complete = vi.fn()
  const router = fakeRouter({ complete })

  const result = await verifyFact(
    router,
    { ...DEADLINE_FACT, quote: 'close on 9 December 2027' },
    SNAPSHOT,
    'groq',
    PROMPTS_DIR,
  )

  expect(result.status).toBe('provisional')
  expect(result.reason).toMatch(/quote/i)
  expect(complete).not.toHaveBeenCalled()
})

test('a date the quote does not support is provisional', async () => {
  const complete = vi.fn()
  const router = fakeRouter({ complete })

  const result = await verifyFact(
    router,
    { ...DEADLINE_FACT, value: '2027-11-03', quote: 'open on 1 August 2027' },
    SNAPSHOT,
    'groq',
    PROMPTS_DIR,
  )

  expect(result.status).toBe('provisional')
  expect(result.reason).toMatch(/date/i)
  expect(complete).not.toHaveBeenCalled()
})

test('a fact with no second provider available is provisional', async () => {
  const router = fakeRouter({ available: () => [] })

  const result = await verifyFact(router, DEADLINE_FACT, SNAPSHOT, 'groq', PROMPTS_DIR)

  expect(result.status).toBe('provisional')
  expect(result.reason).toMatch(/second provider/i)
})

test('agreement with a supporting quote is verified', async () => {
  const complete = vi.fn(async () => ({
    text: JSON.stringify({
      agreed: true,
      quote: 'close on 3 November 2027',
      reason: 'The page states the deadline.',
    }),
    providerId: 'gemini',
    model: 'gemini-2.5-flash',
  }))
  const router = fakeRouter({ complete })

  const result = await verifyFact(router, DEADLINE_FACT, SNAPSHOT, 'groq', PROMPTS_DIR, {
    today: '2026-11-27',
  })

  expect(result.status).toBe('verified')
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'verify' }), {
    exclude: ['groq'],
  })
})

test('disagreement is provisional', async () => {
  const complete = vi.fn(async () => ({
    text: JSON.stringify({ agreed: false, quote: null, reason: 'The page says a different date.' }),
    providerId: 'gemini',
    model: 'gemini-2.5-flash',
  }))
  const router = fakeRouter({ complete })

  const result = await verifyFact(router, DEADLINE_FACT, SNAPSHOT, 'groq', PROMPTS_DIR)

  expect(result.status).toBe('provisional')
})

test('a verifier quote that is not in the page is provisional', async () => {
  const complete = vi.fn(async () => ({
    text: JSON.stringify({ agreed: true, quote: 'close on 9 December 2027', reason: 'ok' }),
    providerId: 'gemini',
    model: 'gemini-2.5-flash',
  }))
  const router = fakeRouter({ complete })

  const result = await verifyFact(router, DEADLINE_FACT, SNAPSHOT, 'groq', PROMPTS_DIR)

  expect(result.status).toBe('provisional')
})

test('an apply URL on an unofficial host is provisional before any model call', async () => {
  const complete = vi.fn()
  const router = fakeRouter({ complete })

  const result = await verifyFact(
    router,
    {
      field: 'applyUrl',
      value: 'https://evil.example/apply',
      quote: 'Apply at https://evil.example/apply',
      sourceUrl: PAGE_URL,
    },
    { ...SNAPSHOT, text: `${SNAPSHOT.text}\nApply at https://evil.example/apply` },
    'groq',
    PROMPTS_DIR,
    { officialHosts: ['chevening.org'] },
  )

  expect(result.status).toBe('provisional')
  expect(complete).not.toHaveBeenCalled()
})
