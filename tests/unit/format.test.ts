import { expect, test } from 'vitest'
import { STUDY_LEVELS } from '../../src/lib/constants'
import { daysUntil, formatDate, formatDeadline, formatMoney, fundingLabel, studyLevelLabel } from '../../src/lib/format'

test('formats ISO dates in UTC', () => {
  expect(formatDate('2027-01-15')).toBe('15 Jan 2027')
})

test('unverified deadlines never render a date', () => {
  expect(formatDeadline('2027-01-15', 'provisional')).not.toContain('2027')
  expect(formatDeadline('2027-01-15', 'unverified')).toContain('not confirmed')
})

test('verified deadlines render the date', () => {
  expect(formatDeadline('2027-01-15', 'verified')).toContain('15 Jan 2027')
})

test('null deadline has its own copy', () => {
  expect(formatDeadline(null, 'unverified')).toBe('No deadline listed')
})

test('daysUntil is timezone-safe', () => {
  expect(daysUntil('2027-01-01', new Date('2026-12-30T00:00:00Z'))).toBe(2)
})

test('formatMoney contains PKR and formatted amount', () => {
  expect(formatMoney(50000, 'PKR')).toContain('PKR')
  expect(formatMoney(50000, 'PKR')).toContain('50,000')
})

test('fundingLabel returns Fully funded', () => {
  expect(fundingLabel('fully-funded')).toBe('Fully funded')
})

test('studyLevelLabel returns readable labels for every level', () => {
  expect(STUDY_LEVELS.map(studyLevelLabel)).toEqual([
    'Matric',
    'Intermediate',
    "Bachelor's",
    "Master's",
    'PhD',
  ])
})