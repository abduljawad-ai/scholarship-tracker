import { expect, test, vi } from 'vitest'
import { createProvider } from '../../scripts/pipeline/providers'
import { ProviderQuotaError } from '../../scripts/pipeline/http'
import type { FetchLike } from '../../scripts/pipeline/http'
import type { AiRequest } from '../../scripts/pipeline/types'

const REQUEST: AiRequest = {
  task: 'extract',
  system: 'SYS',
  user: 'USER',
  temperature: 0,
  maxOutputTokens: 512,
}

const SIGNAL = new AbortController().signal

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function readCall(fetchImpl: ReturnType<typeof vi.fn>): {
  url: string
  init: RequestInit
  body: Record<string, unknown>
  headers: Record<string, string>
} {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
  return {
    url,
    init,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
  }
}

test('Groq posts JSON mode and parses the first choice', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    jsonResponse({ choices: [{ message: { content: '{"pageKind":"program"}' } }] }),
  )

  const provider = createProvider(
    'groq',
    { apiKey: 'groq-key', model: 'openai/gpt-oss-120b' },
    fetchImpl,
  )
  const text = await provider.complete(REQUEST, SIGNAL)

  expect(text).toBe('{"pageKind":"program"}')
  expect(provider.model).toBe('openai/gpt-oss-120b')

  const call = readCall(fetchImpl)
  expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions')
  expect(call.body.response_format).toEqual({ type: 'json_object' })
  expect(call.body.messages).toEqual([
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USER' },
  ])
  expect(call.headers.authorization).toBe('Bearer groq-key')
})

test('Gemini posts to the model endpoint with a JSON response type', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
  )

  const provider = createProvider(
    'gemini',
    { apiKey: 'gemini-key', model: 'gemini-2.5-flash' },
    fetchImpl,
  )
  const text = await provider.complete(REQUEST, SIGNAL)

  expect(text).toBe('{"ok":true}')

  const call = readCall(fetchImpl)
  expect(call.url).toBe(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  )
  expect(call.body.generationConfig).toMatchObject({ responseMimeType: 'application/json' })
  expect(call.body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] })
  expect(call.headers['x-goog-api-key']).toBe('gemini-key')
})

test('Cloudflare posts to the account AI endpoint and parses result.response', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ result: { response: '{"ok":1}' } }))

  const provider = createProvider(
    'cloudflare',
    {
      apiKey: 'cf-token',
      model: '@cf/meta/llama-3.1-8b-instruct',
      accountId: 'acct-123',
    },
    fetchImpl,
  )
  const text = await provider.complete(REQUEST, SIGNAL)

  expect(text).toBe('{"ok":1}')

  const call = readCall(fetchImpl)
  expect(call.url).toBe(
    'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/run/@cf/meta/llama-3.1-8b-instruct',
  )
  expect(call.headers.authorization).toBe('Bearer cf-token')
})

test('OpenRouter posts with its required attribution headers', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    jsonResponse({ choices: [{ message: { content: '{"ok":2}' } }] }),
  )

  const provider = createProvider(
    'openrouter',
    { apiKey: 'or-key', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    fetchImpl,
  )
  const text = await provider.complete(REQUEST, SIGNAL)

  expect(text).toBe('{"ok":2}')

  const call = readCall(fetchImpl)
  expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect(call.headers['HTTP-Referer']).toBe('https://scholarships-pk.pages.dev')
  expect(call.headers['X-Title']).toBe('Scholarship Tracker')
})

test('a 429 response throws ProviderQuotaError with a retry delay', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () =>
    jsonResponse({ error: { message: 'rate limit exceeded' } }, 429, { 'retry-after': '30' }),
  )

  const provider = createProvider('groq', { apiKey: 'k', model: 'm' }, fetchImpl)

  await expect(provider.complete(REQUEST, SIGNAL)).rejects.toMatchObject({
    name: 'ProviderQuotaError',
    retryAfterMs: 30_000,
  })
  await expect(provider.complete(REQUEST, SIGNAL)).rejects.toBeInstanceOf(ProviderQuotaError)
})

test('a missing completion body throws a request error', async () => {
  const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ choices: [] }))
  const provider = createProvider('groq', { apiKey: 'k', model: 'm' }, fetchImpl)

  await expect(provider.complete(REQUEST, SIGNAL)).rejects.toMatchObject({
    name: 'ProviderRequestError',
  })
})
