import { expect, test } from 'vitest'
import {
  exportTracker,
  importTracker,
  loadTracker,
  removeEntry,
  saveTracker,
  upsertEntry,
} from '../../src/lib/tracker'

const entry = {
  programId: 'chevening-pakistan',
  cycleId: '2027',
  status: 'applied' as const,
  note: '',
  updatedAt: '2026-11-27T00:00:00Z',
}

test('corrupted storage falls back to empty state', () => {
  const storage = { getItem: () => '{not json' }
  expect(loadTracker(storage)).toEqual({ version: 1, entries: [] })
})

test('export/import round-trips', () => {
  const state = upsertEntry({ version: 1, entries: [] }, entry)
  expect(importTracker(exportTracker(state))).toEqual(state)
})

test('invalid import code is rejected', () => {
  expect(() => importTracker('not-a-code')).toThrow(/invalid/i)
})

test('removeEntry removes only the matching cycle', () => {
  const state = upsertEntry({ version: 1, entries: [] }, entry)
  expect(removeEntry(state, entry.programId, entry.cycleId).entries).toHaveLength(0)
})

test('non-ASCII notes survive export/import', () => {
  const noteEntry = { ...entry, note: 'Café ☕ — 日本語 naïve résumé' }
  const state = upsertEntry({ version: 1, entries: [] }, noteEntry)
  expect(importTracker(exportTracker(state))).toEqual(state)
})

test('removeEntry keeps other cycles of the same program', () => {
  const first = upsertEntry({ version: 1, entries: [] }, entry)
  const withSecond = upsertEntry(first, { ...entry, cycleId: '2028', status: 'saved' })
  const after = removeEntry(withSecond, entry.programId, entry.cycleId)
  expect(after.entries.map((item) => item.cycleId)).toEqual(['2028'])
  expect(first.entries).toHaveLength(1)
})

test('invalid shape and wrong version fall back to empty state', () => {
  expect(loadTracker({ getItem: () => '{"version":2,"entries":[]}' })).toEqual({
    version: 1,
    entries: [],
  })
  expect(
    loadTracker({
      getItem: () =>
        JSON.stringify({
          version: 1,
          entries: [{ programId: 'p', cycleId: 'c', status: 'maybe', note: '', updatedAt: 'x' }],
        }),
    }),
  ).toEqual({ version: 1, entries: [] })
  expect(loadTracker()).toEqual({ version: 1, entries: [] })
})

test('save/load round-trips through a fake storage', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const state = upsertEntry({ version: 1, entries: [] }, { ...entry, note: 'Saved locally' })
  saveTracker(state, storage)
  expect(loadTracker(storage)).toEqual(state)
})

test('saveTracker never throws when storage is blocked', () => {
  const storage = {
    setItem: () => {
      throw new Error('quota exceeded')
    },
  }
  expect(() => saveTracker({ version: 1, entries: [] }, storage)).not.toThrow()
})
