import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../scripts/pipeline/pdf', () => ({
  pdfToText: vi.fn(async () => 'PDF body'),
}))

import {
  clearRobotsCache,
  fetchBytes,
  fetchText,
  FetchError,
  robotsAllows,
  type FetchLike,
} from '../../scripts/pipeline/fetch'

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

function response(body: BodyInit, init: ResponseInit = {}): Response {
  return new Response(body, init)
}

beforeEach(() => {
  clearRobotsCache()
})

test('a 200 response returns text, final URL, content type, and a SHA-256 hash', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response('<h1>Hello</h1><p>World</p>', { status: 200, headers: HTML_HEADERS }),
  )

  const snapshot = await fetchText('https://example.com/page', { fetchImpl })

  expect(snapshot.status).toBe(200)
  expect(snapshot.finalUrl).toBe('https://example.com/page')
  expect(snapshot.contentType).toBe('text/html')
  expect(snapshot.text).toContain('Hello')
  expect(snapshot.text).toContain('World')
  expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/)
})

test('identical bodies hash the same; one changed character changes the hash', async () => {
  const body = 'A stable plain text body.'
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
  )
  const changed = vi.fn<FetchLike>(async () =>
    response('A stable plain text body!', { status: 200, headers: { 'content-type': 'text/plain' } }),
  )

  const first = await fetchText('https://example.com/a', { fetchImpl })
  const second = await fetchText('https://example.com/a', { fetchImpl })
  const third = await fetchText('https://example.com/a', { fetchImpl: changed })

  expect(first.hash).toBe(second.hash)
  expect(third.hash).not.toBe(first.hash)
})

test('a 503 retries and then succeeds', async () => {
  let calls = 0
  const fetchImpl = vi.fn<FetchLike>(async () => {
    calls += 1
    return calls === 1
      ? response('busy', { status: 503 })
      : response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  })
  const sleep = vi.fn(async () => {})

  const snapshot = await fetchText('https://example.com/page', { fetchImpl, sleep })

  expect(snapshot.text).toBe('ok')
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledTimes(1)
})

test('a 404 does not retry and throws FetchError with status 404', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => response('nope', { status: 404 }))

  await expect(fetchText('https://example.com/missing', { fetchImpl })).rejects.toMatchObject({
    name: 'FetchError',
    status: 404,
  })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(new FetchError('x', 404, 'https://example.com')).toBeInstanceOf(Error)
})

test('a 429 with Retry-After waits that long and retries', async () => {
  let calls = 0
  const fetchImpl = vi.fn<FetchLike>(async () => {
    calls += 1
    return calls === 1
      ? response('slow down', { status: 429, headers: { 'retry-after': '1' } })
      : response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  })
  const sleep = vi.fn(async () => {})

  const snapshot = await fetchText('https://example.com/page', { fetchImpl, sleep })

  expect(snapshot.text).toBe('ok')
  expect(sleep).toHaveBeenCalledWith(1000)
})

test('a timeout aborts and throws', async () => {
  const hanging: FetchLike = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })

  await expect(
    fetchText('https://example.com/slow', { fetchImpl: hanging, timeoutMs: 10, maxAttempts: 1 }),
  ).rejects.toMatchObject({ name: 'FetchError', status: null })
})

test('a PDF response is converted to text through pdfToText', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }),
  )

  const snapshot = await fetchText('https://example.com/file.pdf', { fetchImpl })

  expect(snapshot.text).toBe('PDF body')
  expect(snapshot.contentType).toBe('application/pdf')
})

test('fetchBytes returns the raw bytes and their hash', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response(new Uint8Array([9, 8, 7]), { status: 200, headers: { 'content-type': 'application/pdf' } }),
  )

  const snapshot = await fetchBytes('https://example.com/file.pdf', { fetchImpl })

  expect(Array.from(snapshot.bytes)).toEqual([9, 8, 7])
  expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/)
})

test('an unsupported content type throws', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response('binary', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  )

  await expect(fetchText('https://example.com/blob', { fetchImpl })).rejects.toMatchObject({
    name: 'FetchError',
    status: 200,
  })
})

test('robotsAllows returns true when robots.txt is 404', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => response('not found', { status: 404 }))

  await expect(robotsAllows('https://example.com/page', { fetchImpl })).resolves.toBe(true)
})

test('a matching Disallow blocks the path', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response('User-agent: *\nDisallow: /private\n', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  )

  await expect(robotsAllows('https://example.com/private/page', { fetchImpl })).resolves.toBe(false)
  await expect(robotsAllows('https://example.com/public/page', { fetchImpl })).resolves.toBe(true)
})

test('a longer Allow overrides a broader Disallow', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response('User-agent: *\nDisallow: /private\nAllow: /private/public\n', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  )

  await expect(
    robotsAllows('https://example.com/private/public/page', { fetchImpl }),
  ).resolves.toBe(true)
})

test('robots rules for our bot replace the wildcard group', async () => {
  const body = [
    'User-agent: *',
    'Disallow: /',
    '',
    'User-agent: ScholarshipTrackerBot',
    'Allow: /scholarships/',
    'Disallow: /private',
  ].join('\n')
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
  )

  await expect(
    robotsAllows('https://example.com/scholarships/list', { fetchImpl }),
  ).resolves.toBe(true)
  await expect(robotsAllows('https://example.com/private/x', { fetchImpl })).resolves.toBe(false)
  // RFC 9309: when a group matches the crawler, the wildcard group is ignored.
  await expect(robotsAllows('https://example.com/other', { fetchImpl })).resolves.toBe(true)
})

test('robots.txt is cached per origin', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    response('User-agent: *\nDisallow: /private\n', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  )

  await robotsAllows('https://example.com/a', { fetchImpl })
  await robotsAllows('https://example.com/b', { fetchImpl })

  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
