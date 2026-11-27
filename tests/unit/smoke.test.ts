import { expect, test } from 'vitest'
import { APP_NAME } from '../../src/lib/constants'

test('app name is set', () => {
  expect(APP_NAME).toBe('Scholarship Tracker')
})
