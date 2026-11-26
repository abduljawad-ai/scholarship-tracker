import { expect, test } from 'vitest'
import { parseProgram } from '../../src/lib/schema'
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync('src/data/programs/chevening-pakistan.json', 'utf8'))

test('valid seed program parses', () => {
  expect(parseProgram(seed).programId).toBe('chevening-pakistan')
})

test('programId must be a lowercase slug', () => {
  expect(() => parseProgram({ ...seed, programId: 'Bad ID' })).toThrow()
})

test('a program needs at least one cycle', () => {
  expect(() => parseProgram({ ...seed, cycles: [] })).toThrow()
})

test('unknown verification status is rejected', () => {
  const bad = structuredClone(seed)
  bad.cycles[0].verification.deadline = 'maybe'
  expect(() => parseProgram(bad)).toThrow()
})

test('null deadline is allowed', () => {
  const ok = structuredClone(seed)
  ok.cycles[0].dates.deadline = null
  expect(parseProgram(ok).cycles[0].dates.deadline).toBeNull()
})
