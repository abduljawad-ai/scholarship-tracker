import { expect, test, vi } from 'vitest'
import { loadConfig } from '../../scripts/pipeline/config'
import { ProvidersExhaustedError, createRouter } from '../../scripts/pipeline/router'
import { emptyState, createMemoryStore, recordProviderCall, setProviderCooldown } from '../../scripts/pipeline/state'
import type { FetchLike } from '../../scripts/pipeline/http'
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
  const router = createRouter({
    config,
    store,
    fetchImpl,
    now: () => NOW,
  })
  return { router, persist, getState: () => store.get(), fetchImpl }
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
