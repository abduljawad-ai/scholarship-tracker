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
  })
})

test('GEMINI_MODEL overrides the default model', () => {
  const config = loadConfig(
    { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3-pro' },
    '/srv/app',
  )
  expect(config.providers.gemini!.model).toBe('gemini-3-pro')
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
