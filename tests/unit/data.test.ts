// tests/unit/data.test.ts
import { expect, test } from 'vitest'
import { activePrograms, archivedPrograms, isActive, loadPrograms, nextCycle } from '../../src/lib/data'
import { deriveCycleStatus } from '../../src/lib/cycle-status'

test('loads and validates all seed programs', () => {
  const programs = loadPrograms()
  expect(programs.length).toBe(9)
  expect(new Set(programs.map(p => p.programId)).size).toBe(9)
})

test('multi-cycle program is active and nextCycle picks the live cycle', () => {
  const erasmus = loadPrograms().find(p => p.programId === 'erasmus-mundus-joint-masters')!
  expect(isActive(erasmus)).toBe(true)
  expect(nextCycle(erasmus)!.status).toBe('upcoming')
})

test('every seed cycle status matches its dates when the dates decide', () => {
  for (const program of loadPrograms()) {
    for (const cycle of program.cycles) {
      if (cycle.status === 'archived') continue
      const derived = deriveCycleStatus(cycle.dates, '2026-11-27')
      if (derived === null) continue
      expect(derived, `${program.programId}/${cycle.cycleId}`).toBe(cycle.status)
    }
  }
})

test('archived-only program is not active', () => {
  const programs = loadPrograms().map(p => ({
    ...p,
    cycles: p.cycles.map(c => ({ ...c, status: 'closed' as const })),
  }))
  expect(activePrograms(programs)).toHaveLength(0)
  expect(archivedPrograms(programs)).toHaveLength(9)
})

test('nextCycle ignores closed cycles', () => {
  const p = loadPrograms().find(p => p.programId === 'erasmus-mundus-joint-masters')!
  const cycle = nextCycle(p)!
  expect(cycle.status).not.toBe('closed')
})
