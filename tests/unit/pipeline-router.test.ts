import { expect, test, vi } from 'vitest'
import { loadConfig } from '../../scripts/pipeline/config'
import { ProvidersExhaustedError, createRouter } from '../../scripts/pipeline/router'
import { emptyState, createMemoryStore, recordProviderCall, setProviderCooldown } from '../../scripts/pipeline/state'
import type { FetchLike } from '../../scripts/pipeline/http'
import { parseRetryHint } from '../../scripts/pipeline/http'
import type { AiRequest, PipelineState } from '../../scripts/pipeline/types'

const NOW = new Date('2026-11-27T06:00:00.000Z') // 11:00 in Pakistan
const DAY = '2026-11-27'

const REQUEST: AiRequest = {
  task: 'extract',
  system: 'SYS',
  user: 'USER',
  temperature: 0,
  maxOutputTokens: 512,
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function groqAnswer(text: string): Response {
  return jsonResponse({ choices: [{ message: { content: text } }] })
}

function geminiAnswer(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] })
}

interface FixtureOptions {
  state?: PipelineState
  groq?: () => Response
}

function fixture(options: FixtureOptions = {}) {
  const config = loadConfig({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }, '/srv/app')
  const base = createMemoryStore(options.state ?? emptyState())
  const persist = vi.fn((next: PipelineState) => base.set(next))
  const store = { get: base.get, set: persist }
  const fetchImpl = vi.fn<FetchLike>(async (url) =>
    url.includes('groq.com')
      ? (options.groq ?? (() => groqAnswer('from groq')))()
      : geminiAnswer('from gemini'),
  )
  const sleep = vi.fn(async () => {})
  const router = createRouter({
    config,
    store,
    fetchImpl,
    now: () => NOW,
    sleep,
  })
  return { router, persist, sleep, getState: () => store.get(), fetchImpl }
}

test('the first configured provider in the task order is used', async () => {
  const { router } = fixture()

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('groq')
  expect(response.text).toBe('from groq')
  expect(response.model).toBe('openai/gpt-oss-120b')
})

test('a 429 cools that provider down and the next provider answers', async () => {
  const { router, getState } = fixture({
    groq: () =>
      jsonResponse({ error: { message: 'rate limit exceeded' } }, 429, { 'retry-after': '60' }),
  })

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('gemini')
  expect(getState().providers.groq?.cooldownUntil).toBe('2026-11-27T06:01:00.000Z')
  expect(router.available('extract')).toEqual(['gemini'])
})

test('exclude skips the primary provider for the second-model check', async () => {
  const { router, fetchImpl } = fixture()

  const response = await router.complete(REQUEST, { exclude: ['groq'] })

  expect(response.providerId).toBe('gemini')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(String(fetchImpl.mock.calls[0]![0])).toContain('generativelanguage.googleapis.com')
})

test('a provider over the daily cap is skipped', async () => {
  let state = emptyState()
  for (let call = 0; call < 180; call += 1) state = recordProviderCall(state, 'groq', DAY)
  const { router } = fixture({ state })

  expect(router.available('extract')).toEqual([])
  await expect(router.complete(REQUEST)).rejects.toBeInstanceOf(ProvidersExhaustedError)
})

test('all providers cooling down throws ProvidersExhaustedError', async () => {
  let state = emptyState()
  state = setProviderCooldown(state, 'groq', '2026-11-27T07:00:00.000Z')
  state = setProviderCooldown(state, 'gemini', '2026-11-27T07:00:00.000Z')
  const { router } = fixture({ state })

  await expect(router.complete(REQUEST)).rejects.toBeInstanceOf(ProvidersExhaustedError)
})

test('a successful call increments the day count and persists once', async () => {
  const { router, persist, getState } = fixture()

  await router.complete(REQUEST)

  expect(getState().providers.groq?.callsByDay[DAY]).toBe(1)
  expect(persist).toHaveBeenCalledTimes(1)
})

test('available lists only configured, ready providers', () => {
  const config = loadConfig({ GROQ_API_KEY: 'q' }, '/srv/app')
  const router = createRouter({
    config,
    store: createMemoryStore(emptyState()),
    fetchImpl: vi.fn<FetchLike>(),
    now: () => NOW,
  })

  expect(router.available('extract')).toEqual(['groq'])
  expect(router.available('verify')).toEqual(['groq'])
  expect(router.available('extract', ['groq'])).toEqual([])
})

test('a provider request error falls through without a cooldown', async () => {
  const { router, getState } = fixture({
    groq: () => jsonResponse({ error: { message: 'server exploded' } }, 500),
  })

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('gemini')
  expect(getState().providers.groq?.cooldownUntil ?? null).toBeNull()
})

test('a short rate limit is waited out and the same provider retries', async () => {
  let call = 0
  const { router, sleep, getState } = fixture({
    groq: () => {
      call += 1
      return call === 1
        ? jsonResponse({ error: { message: 'rate limit exceeded' } }, 429, {
            'retry-after': '1',
          })
        : groqAnswer('from groq')
    },
  })

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('groq')
  expect(response.text).toBe('from groq')
  expect(sleep).toHaveBeenCalledWith(1250)
  expect(getState().providers.groq?.cooldownUntil ?? null).toBeNull()
})

test('retry hints parse seconds, minutes, and millis', () => {
  expect(parseRetryHint('Please try again in 9.17s.')).toBe(9170)
  expect(parseRetryHint('retry in 1m30s')).toBe(90_000)
  expect(parseRetryHint('available in 250ms')).toBe(250)
  expect(parseRetryHint('rate limit exceeded')).toBeNull()
  expect(parseRetryHint(null)).toBeNull()
})

test('the retry hint in the message is used when the header is missing', async () => {
  let call = 0
  const { router, sleep } = fixture({
    groq: () => {
      call += 1
      return call === 1
        ? jsonResponse(
            {
              error: {
                message:
                  'Rate limit reached for model `openai/gpt-oss-120b`. Please try again in 9.17s.',
              },
            },
            429,
          )
        : groqAnswer('from groq')
    },
  })

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('groq')
  expect(sleep).toHaveBeenCalledWith(9420)
})

test('a rate limit that outlasts the retries cools down and falls through', async () => {
  const { router, sleep, getState } = fixture({
    groq: () =>
      jsonResponse({ error: { message: 'rate limit exceeded' } }, 429, {
        'retry-after': '2',
      }),
  })

  const response = await router.complete(REQUEST)

  expect(response.providerId).toBe('gemini')
  expect(sleep).toHaveBeenCalledTimes(2)
  expect(getState().providers.groq?.cooldownUntil).toBe('2026-11-27T06:00:02.000Z')
})

test('multi-key pool rotates round-robin across requests', async () => {
  const config = loadConfig(
    {
      GROQ_API_KEY_1: 'key-1',
      GROQ_API_KEY_2: 'key-2',
      GROQ_API_KEY_3: 'key-3',
    },
    '/srv/app',
  )
  const store = createMemoryStore(emptyState())
  const usedKeys: string[] = []
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
    const auth = (init?.headers as Record<string, string>)?.authorization ?? ''
    usedKeys.push(auth.replace('Bearer ', ''))
    return groqAnswer('answer')
  })

  const router = createRouter({ config, store, fetchImpl, now: () => NOW })

  const res1 = await router.complete(REQUEST)
  const res2 = await router.complete(REQUEST)
  const res3 = await router.complete(REQUEST)
  const res4 = await router.complete(REQUEST)

  expect(res1.keyLabel).toBe('groq:1')
  expect(res2.keyLabel).toBe('groq:2')
  expect(res3.keyLabel).toBe('groq:3')
  expect(res4.keyLabel).toBe('groq:1')
  expect(usedKeys).toEqual(['key-1', 'key-2', 'key-3', 'key-1'])
})

test('multi-key failover: when one key hits 429, the next key takes over immediately without sleeping', async () => {
  const config = loadConfig(
    {
      GROQ_API_KEY_1: 'key-1',
      GROQ_API_KEY_2: 'key-2',
    },
    '/srv/app',
  )
  const store = createMemoryStore(emptyState())
  const sleep = vi.fn(async () => {})
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
    const auth = (init?.headers as Record<string, string>)?.authorization ?? ''
    if (auth.includes('key-1')) {
      return jsonResponse({ error: { message: 'rate limit 429' } }, 429, { 'retry-after': '60' })
    }
    return groqAnswer('answer from key 2')
  })

  const router = createRouter({ config, store, fetchImpl, now: () => NOW, sleep })

  const response = await router.complete(REQUEST)

  expect(response.keyLabel).toBe('groq:2')
  expect(response.text).toBe('answer from key 2')
  // No sleep needed because key-2 was ready right away!
  expect(sleep).not.toHaveBeenCalled()
  expect(store.get().providers.groq?.keys?.['groq:1']?.cooldownUntil).toBe('2026-11-27T06:01:00.000Z')
  expect(store.get().providers.groq?.keys?.['groq:2']?.callsByDay[DAY]).toBe(1)
})

test('multi-key failover: invalid auth on one key cools it for 24h and moves to next key', async () => {
  const config = loadConfig(
    {
      GROQ_API_KEY_1: 'bad-key',
      GROQ_API_KEY_2: 'good-key',
    },
    '/srv/app',
  )
  const store = createMemoryStore(emptyState())
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
    const auth = (init?.headers as Record<string, string>)?.authorization ?? ''
    if (auth.includes('bad-key')) {
      return jsonResponse({ error: { message: 'invalid api key' } }, 401)
    }
    return groqAnswer('success')
  })

  const router = createRouter({ config, store, fetchImpl, now: () => NOW })

  const response = await router.complete(REQUEST)

  expect(response.keyLabel).toBe('groq:2')
  expect(store.get().providers.groq?.keys?.['groq:1']?.cooldownUntil).toBe('2026-11-28T06:00:00.000Z')
})
