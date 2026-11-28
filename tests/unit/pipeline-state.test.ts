import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  callsOn,
  emptyState,
  itemKey,
  loadState,
  providerReady,
  recordProviderCall,
  saveState,
  setProviderCooldown,
  startOrResumeRun,
  updateItem,
} from '../../scripts/pipeline/state'

function stateFile(content?: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'))
  const file = path.join(dir, 'state.json')
  if (content !== undefined) writeFileSync(file, JSON.stringify(content))
  return file
}

test('a missing file returns an empty state', () => {
  const state = loadState(path.join(mkdtempSync(path.join(tmpdir(), 'state-')), 'state.json'))
  expect(state).toEqual(emptyState())
  expect(state.version).toBe(1)
  expect(state.run).toBeNull()
})

test('saveState round-trips and leaves no .tmp file', () => {
  const file = stateFile()
  const state = startOrResumeRun(emptyState(), 'run-1', '2026-11-27T00:00:00.000Z')
  saveState(file, state)
  expect(loadState(file)).toEqual(state)
  expect(existsSync(`${file}.tmp`)).toBe(false)
})

test('invalid JSON throws instead of resetting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'))
  const file = path.join(dir, 'state.json')
  writeFileSync(file, '{not json')
  expect(() => loadState(file)).toThrow(/corrupt|invalid/i)
})

test('a wrong version throws', () => {
  const file = stateFile({ ...emptyState(), version: 99 })
  expect(() => loadState(file)).toThrow(/version|corrupt/i)
})

test('startOrResumeRun keeps a paused run and replaces a complete one', () => {
  const paused = startOrResumeRun(emptyState(), 'run-1', '2026-11-27T00:00:00.000Z')
  paused.run!.status = 'paused'
  const resumed = startOrResumeRun(paused, 'run-2', '2026-11-28T00:00:00.000Z')
  expect(resumed.run!.runId).toBe('run-1')
  expect(resumed.run!.status).toBe('paused')

  paused.run!.status = 'complete'
  const replaced = startOrResumeRun(paused, 'run-3', '2026-11-29T00:00:00.000Z')
  expect(replaced.run!.runId).toBe('run-3')
  expect(replaced.run!.status).toBe('running')
})

test('updateItem changes only the target item', () => {
  const state = startOrResumeRun(emptyState(), 'run-1', '2026-11-27T00:00:00.000Z')
  state.run!.items['a'] = {
    state: 'pending',
    attempts: 0,
    hash: null,
    lastError: null,
    updatedAt: '2026-11-27T00:00:00.000Z',
  }
  state.run!.items['b'] = { ...state.run!.items['a'] }

  const next = updateItem(state, 'a', {
    state: 'published',
    updatedAt: '2026-11-27T01:00:00.000Z',
  })
  expect(next.run!.items['a'].state).toBe('published')
  expect(next.run!.items['b'].state).toBe('pending')
  // The input state is not mutated.
  expect(state.run!.items['a'].state).toBe('pending')
})

test('itemKey distinguishes two sources sharing one URL', () => {
  expect(itemKey('sindh-endowment', 'https://www.sindh.gov.pk/')).not.toBe(
    itemKey('sindh-matric', 'https://www.sindh.gov.pk/'),
  )
})

test('recordProviderCall increments only the matching day', () => {
  let state = emptyState()
  state = recordProviderCall(state, 'gemini', '2026-11-27')
  state = recordProviderCall(state, 'gemini', '2026-11-27')
  state = recordProviderCall(state, 'gemini', '2026-11-28')
  state = recordProviderCall(state, 'groq', '2026-11-27')

  expect(callsOn(state, '2026-11-27')).toBe(3)
  expect(state.providers.gemini.callsByDay['2026-11-27']).toBe(2)
  expect(state.providers.gemini.callsByDay['2026-11-28']).toBe(1)
  expect(state.providers.groq.callsByDay['2026-11-27']).toBe(1)
})

test('providerReady is false inside a cooldown and true after it', () => {
  const now = new Date('2026-11-27T12:00:00.000Z')
  let state = setProviderCooldown(emptyState(), 'gemini', '2026-11-27T12:15:00.000Z')
  expect(providerReady(state, 'gemini', now)).toBe(false)
  expect(providerReady(state, 'groq', now)).toBe(true)
  expect(providerReady(state, 'gemini', new Date('2026-11-27T12:16:00.000Z'))).toBe(true)
})

test('saved JSON is pretty-printed with a trailing newline', () => {
  const file = stateFile()
  saveState(file, emptyState())
  const raw = readFileSync(file, 'utf8')
  expect(raw.endsWith('\n')).toBe(true)
  expect(raw).toContain('\n  "version": 1')
})
