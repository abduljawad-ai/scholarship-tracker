import path from 'node:path'
import { expect, test } from 'vitest'
import { loadConfig } from '../../scripts/pipeline/config'

test('no keys means no providers', () => {
  const config = loadConfig({}, '/srv/app')
  expect(config.providers).toEqual({})
})

test('GEMINI_API_KEY configures only Gemini with the default model', () => {
  const config = loadConfig({ GEMINI_API_KEY: 'test-key' }, '/srv/app')
  expect(Object.keys(config.providers)).toEqual(['gemini'])
  expect(config.providers.gemini).toEqual({
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    keys: [{ label: 'gemini:1', apiKey: 'test-key' }],
  })
})

test('GEMINI_MODEL overrides the default model', () => {
  const config = loadConfig(
    { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3-pro' },
    '/srv/app',
  )
  expect(config.providers.gemini!.model).toBe('gemini-3-pro')
})

test('GROQ_API_KEY configures Groq with a default single key', () => {
  const config = loadConfig({ GROQ_API_KEY: 'g-default' }, '/srv/app')
  expect(config.providers.groq).toEqual({
    apiKey: 'g-default',
    model: 'openai/gpt-oss-120b',
    keys: [{ label: 'groq:1', apiKey: 'g-default' }],
  })
})

test('GROQ_API_KEY_1 through 8 configures a key pool', () => {
  const env: Record<string, string> = {}
  for (let i = 1; i <= 8; i++) {
    env[`GROQ_API_KEY_${i}`] = `groq-key-${i}`
  }
  const config = loadConfig(env, '/srv/app')
  expect(config.providers.groq?.keys).toHaveLength(8)
  expect(config.providers.groq?.keys?.[0]).toEqual({ label: 'groq:1', apiKey: 'groq-key-1' })
  expect(config.providers.groq?.keys?.[7]).toEqual({ label: 'groq:8', apiKey: 'groq-key-8' })
  expect(config.providers.groq?.apiKey).toBe('groq-key-1')
})

test('GROQ_API_KEY deduplicates against GROQ_API_KEY_1', () => {
  const config = loadConfig(
    { GROQ_API_KEY: 'same-key', GROQ_API_KEY_1: 'same-key', GROQ_API_KEY_2: 'key-2' },
    '/srv/app',
  )
  expect(config.providers.groq?.keys).toEqual([
    { label: 'groq:1', apiKey: 'same-key' },
    { label: 'groq:2', apiKey: 'key-2' },
  ])
})

test('Cloudflare needs both the token and the account id', () => {
  expect(
    loadConfig({ CLOUDFLARE_API_TOKEN: 'token' }, '/srv/app').providers.cloudflare,
  ).toBeUndefined()

  const config = loadConfig(
    {
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    },
    '/srv/app',
  )
  expect(config.providers.cloudflare).toEqual({
    apiKey: 'token',
    model: '@cf/meta/llama-3.1-8b-instruct',
    accountId: 'account',
    keys: [{ label: 'cloudflare:1', apiKey: 'token' }],
  })
})

test('OpenRouter requires an explicit model', () => {
  expect(
    loadConfig({ OPENROUTER_API_KEY: 'key' }, '/srv/app').providers.openrouter,
  ).toBeUndefined()
})

test('paths resolve under the given root', () => {
  const config = loadConfig({}, '/srv/app')
  expect(config.dataDir).toBe(path.resolve('/srv/app/src/data/programs'))
  expect(config.statePath).toBe(path.resolve('/srv/app/pipeline/state.json'))
  expect(config.registryPath).toBe(path.resolve('/srv/app/pipeline/sources.json'))
  expect(config.candidatesPath).toBe(path.resolve('/srv/app/pipeline/candidates.json'))
  expect(config.runStatusPath).toBe(path.resolve('/srv/app/src/data/run-status.json'))
  expect(config.reportsDir).toBe(path.resolve('/srv/app/pipeline/runs'))
  expect(config.promptsDir).toBe(path.resolve('/srv/app/pipeline/prompts'))
})

test('defaults are stable', () => {
  const config = loadConfig({}, '/srv/app')
  expect(config.dailyCallLimit).toBe(180)
  expect(config.maxAttempts).toBe(3)
  expect(config.requestTimeoutMs).toBe(60_000)
})

test('routing prefers the free model order for each task', () => {
  const config = loadConfig({}, '/srv/app')
  expect(config.routing.extract).toEqual(['groq', 'gemini'])
  expect(config.routing['extract-long']).toEqual(['gemini', 'groq'])
  expect(config.routing.verify).toEqual(['gemini', 'groq'])
  expect(config.routing.discover).toEqual(['groq', 'gemini'])
})
