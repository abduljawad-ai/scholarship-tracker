import { expect, test } from 'vitest'
import { deriveCycleStatus, todayInPakistan } from '../../src/lib/cycle-status'

test('closed when the deadline has passed', () => {
  expect(deriveCycleStatus({ opens: '2026-01-01', deadline: '2026-11-26' }, '2026-11-27')).toBe(
    'closed',
  )
})

test('open on the deadline day', () => {
  expect(deriveCycleStatus({ opens: '2026-01-01', deadline: '2026-11-27' }, '2026-11-27')).toBe(
    'open',
  )
})

test('upcoming before applications open', () => {
  expect(deriveCycleStatus({ opens: '2027-08-01', deadline: '2027-11-03' }, '2026-11-27')).toBe(
    'upcoming',
  )
})

test('open when applications are open', () => {
  expect(deriveCycleStatus({ opens: '2026-11-01', deadline: '2027-01-15' }, '2026-11-27')).toBe(
    'open',
  )
})

test('open when opens is unknown but a future deadline exists', () => {
  expect(deriveCycleStatus({ opens: null, deadline: '2027-01-15' }, '2026-11-27')).toBe('open')
})

test('null when both dates are missing', () => {
  expect(deriveCycleStatus({ opens: null, deadline: null }, '2026-11-27')).toBeNull()
})

test('todayInPakistan crosses midnight in UTC', () => {
  expect(todayInPakistan(new Date('2026-11-27T20:00:00Z'))).toBe('2026-11-28')
  expect(todayInPakistan(new Date('2026-11-27T18:59:00Z'))).toBe('2026-11-27')
})
