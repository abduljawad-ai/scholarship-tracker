import { expect, test } from 'vitest'
import { freshnessMessage, freshnessState, relativeTime } from '../../src/lib/freshness'

test('sample mode wins', () => {
  expect(freshnessState({ mode: 'sample', lastSuccessfulRun: null }, new Date())).toBe('sample')
})

test('live mode with no successful run is stale', () => {
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: null }, new Date())).toBe('stale')
})

test('older than 36 hours is stale', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: '2026-11-25T20:00:00Z' }, now)).toBe(
    'stale',
  )
})

test('recent success is fresh', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: '2026-11-27T03:00:00Z' }, now)).toBe(
    'fresh',
  )
})

test('exactly 36 hours old is still fresh', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: '2026-11-26T00:00:00Z' }, now)).toBe(
    'fresh',
  )
})

test('an unparseable timestamp is stale', () => {
  expect(freshnessState({ mode: 'live', lastSuccessfulRun: 'not-a-date' }, new Date())).toBe(
    'stale',
  )
})

test('relative time reads naturally', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(relativeTime('2026-11-27T11:59:40Z', now)).toBe('just now')
  expect(relativeTime('2026-11-27T11:55:00Z', now)).toBe('5 minutes ago')
  expect(relativeTime('2026-11-27T09:00:00Z', now)).toBe('3 hours ago')
  expect(relativeTime('2026-11-25T12:00:00Z', now)).toBe('2 days ago')
})

test('messages match the agreed copy', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  expect(freshnessMessage('sample', { mode: 'sample', lastSuccessfulRun: null }, now)).toBe(
    'Demo data — automated updates are not connected yet.',
  )
  expect(
    freshnessMessage('stale', { mode: 'live', lastSuccessfulRun: '2026-11-25T12:00:00Z' }, now),
  ).toBe('Data last updated 2 days ago — refresh may be delayed.')
  expect(freshnessMessage('stale', { mode: 'live', lastSuccessfulRun: null }, now)).toBe(
    'Data has not been updated yet — refresh may be delayed.',
  )
  expect(freshnessMessage('fresh', { mode: 'live', lastSuccessfulRun: null }, now)).toBe('')
})
