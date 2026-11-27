// tests/unit/filters.test.ts
import { expect, test } from 'vitest'
import { filterIndex, sortIndex, toIndexEntry } from '../../src/lib/filters'
import { loadPrograms } from '../../src/lib/data'

const entries = loadPrograms().map(toIndexEntry)
const now = new Date('2026-11-27T00:00:00Z')

test('level filter keeps matching programs', () => {
  const out = filterIndex(entries, { query: '', level: 'master', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.length).toBeGreaterThan(0)
  expect(out.every(e => e.fundedLevels.includes('master'))).toBe(true)
})

test('eligible-only never returns archived entries', () => {
  const out = filterIndex(entries, { query: '', level: 'all', currentLevel: 'master', eligibleOnly: true, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.every(e => e.status === 'active')).toBe(true)
})

test('eligible-only uses the precomputed likelyEligibleFor list', () => {
  const out = filterIndex(entries, { query: '', level: 'all', currentLevel: 'bachelor', eligibleOnly: true, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.every(e => e.likelyEligibleFor.includes('bachelor'))).toBe(true)
})

test('search is case-insensitive across title and provider', () => {
  const out = filterIndex(entries, { query: 'CHEVENING', level: 'all', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.some(e => e.programId === 'chevening-pakistan')).toBe(true)
})

test('deadline sort puts nulls last', () => {
  const out = sortIndex(entries, 'deadline')
  const firstNull = out.findIndex(e => e.nextDeadline === null)
  if (firstNull !== -1) {
    expect(out.slice(firstNull).every(e => e.nextDeadline === null)).toBe(true)
  }
})

test('newest sort orders by firstSeen descending', () => {
  const out = sortIndex(entries, 'newest')
  for (let i = 1; i < out.length; i++) {
    expect(out[i - 1].firstSeen >= out[i].firstSeen).toBe(true)
  }
})

test('deadline window only matches verified deadlines', () => {
  const out = filterIndex(entries, { query: '', level: 'all', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: '90', status: 'all' }, now)
  expect(out.every(e => e.deadlineVerified && e.nextDeadline !== null)).toBe(true)
})

test('empty filters return an empty list, not a crash', () => {
  const out = filterIndex(entries, { query: 'zzzz-no-match', level: 'all', currentLevel: 'master', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out).toEqual([])
})

test('country filter matches the exact country', () => {
  const out = filterIndex(entries, { query: '', level: 'all', country: 'Germany', currentLevel: 'bachelor', eligibleOnly: false, funding: 'all', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.map(e => e.programId)).toEqual(['daad-epos'])
})

test('partial funding matches the HEC need-based program', () => {
  const out = filterIndex(entries, { query: '', level: 'all', currentLevel: 'bachelor', eligibleOnly: false, funding: 'partial', deadlineWindow: 'all', status: 'all' }, now)
  expect(out.map(e => e.programId)).toEqual(['hec-need-based'])
})
