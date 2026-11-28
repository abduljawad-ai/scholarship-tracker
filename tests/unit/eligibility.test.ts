import { expect, test } from 'vitest'
import { evaluateEligibility, stagesForCurrentLevel } from '../../src/lib/eligibility'
import { loadPrograms } from '../../src/lib/data'

const programs = loadPrograms()
const chevening = programs.find(p => p.programId === 'chevening-pakistan')!
const turkiye = programs.find(p => p.programId === 'turkiye-burslari')!
// Eligibility is status-driven. These tests exercise the level and rule
// checks, so give each program an open cycle regardless of the live status.
const cheveningCycle = { ...chevening.cycles[0]!, status: 'upcoming' as const }
const turkiyeCycle = { ...turkiye.cycles[0]!, status: 'upcoming' as const }

test('matric students look at intermediate programs', () => {
  expect(stagesForCurrentLevel('matric')).toEqual(['intermediate'])
})

test('Pakistani bachelor student is likely eligible for Chevening', () => {
  const r = evaluateEligibility(chevening, cheveningCycle, { currentLevel: 'bachelor', nationality: 'PK' })
  expect(r.likelyEligible).toBe(true)
})

test('a master student is not eligible for a master\'s scholarship', () => {
  const r = evaluateEligibility(chevening, cheveningCycle, { currentLevel: 'master', nationality: 'PK' })
  expect(r.likelyEligible).toBe(false)
})

test('an intermediate student is not eligible for Chevening', () => {
  const r = evaluateEligibility(chevening, cheveningCycle, { currentLevel: 'intermediate', nationality: 'PK' })
  expect(r.likelyEligible).toBe(false)
})

test('an intermediate student is eligible for Türkiye Bursları', () => {
  const r = evaluateEligibility(turkiye, turkiyeCycle, { currentLevel: 'intermediate', nationality: 'PK' })
  expect(r.likelyEligible).toBe(true)
})

test('a matric student is not eligible for Türkiye Bursları', () => {
  const r = evaluateEligibility(turkiye, turkiyeCycle, { currentLevel: 'matric', nationality: 'PK' })
  expect(r.likelyEligible).toBe(false)
})

test('a program restricted to another nationality is rejected', () => {
  const restricted = { ...chevening, eligibility: { ...chevening.eligibility, nationalities: ['US'] } }
  const r = evaluateEligibility(restricted, cheveningCycle, { currentLevel: 'bachelor', nationality: 'PK' })
  expect(r.likelyEligible).toBe(false)
  expect(r.reasons.join(' ')).toContain('nationality')
})

test('age over the limit is rejected with a reason', () => {
  const p = { ...chevening, eligibility: { ...chevening.eligibility, ageMax: 25 } }
  const r = evaluateEligibility(p, cheveningCycle, { currentLevel: 'bachelor', nationality: 'PK', age: 30 })
  expect(r.likelyEligible).toBe(false)
  expect(r.reasons.join(' ')).toContain('age')
})

test('closed cycle is not eligible', () => {
  const closed = { ...cheveningCycle, status: 'closed' as const }
  expect(evaluateEligibility(chevening, closed, { currentLevel: 'bachelor', nationality: 'PK' }).likelyEligible).toBe(false)
})
