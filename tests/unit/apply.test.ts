import { expect, test } from 'vitest'
import { canApply } from '../../src/lib/apply'
import type { Cycle } from '../../src/lib/schema'

function cycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    cycleId: '2027',
    label: '2027 intake',
    dates: { opens: null, deadline: null, resultsDate: null, studyStart: null },
    status: 'open',
    apply: { url: 'https://example.org/apply/', portalName: null, fee: null },
    verification: {
      deadline: 'unverified',
      applyUrl: 'verified',
      funding: 'unverified',
      eligibility: 'unverified',
    },
    sources: [
      { url: 'https://example.org/scholarships/', type: 'official-page', lastVerified: '2026-11-28' },
    ],
    evidence: [],
    confidence: 1,
    ...overrides,
  }
}

test('an open cycle with a verified apply URL can apply', () => {
  expect(canApply(cycle())).toBe(true)
  expect(canApply(cycle({ status: 'upcoming' }))).toBe(true)
})

test('a closed cycle cannot apply even with a verified URL', () => {
  expect(canApply(cycle({ status: 'closed' }))).toBe(false)
  expect(canApply(cycle({ status: 'archived' }))).toBe(false)
})

test('an unverified or provisional apply URL cannot apply', () => {
  for (const status of ['unverified', 'provisional'] as const) {
    expect(
      canApply(
        cycle({
          verification: { ...cycle().verification, applyUrl: status },
        }),
      ),
    ).toBe(false)
  }
})

test('a missing apply URL cannot apply', () => {
  expect(
    canApply(cycle({ apply: { url: null, portalName: null, fee: null } })),
  ).toBe(false)
})
