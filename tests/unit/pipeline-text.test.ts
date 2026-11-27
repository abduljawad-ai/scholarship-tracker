import { expect, test } from 'vitest'
import { normalizeText, normalizeUrl, quoteAppearsIn } from '../../scripts/pipeline/text'

test('normalizeText folds smart quotes and dashes and collapses whitespace', () => {
  expect(normalizeText('“Applications close” — 3\u00a0November\n2027.')).toBe(
    'applications close - 3 november 2027.',
  )
})

test('quoteAppearsIn matches across line breaks and smart quotes', () => {
  const source = 'Applications close on 3 November\n2027. Apply early.'

  expect(quoteAppearsIn('3 November 2027', source)).toBe(true)
  expect(quoteAppearsIn('“3 November 2027”', source)).toBe(true)
  expect(quoteAppearsIn('3 November   2027', source)).toBe(true)
  expect(quoteAppearsIn('4 November 2027', source)).toBe(false)
  expect(quoteAppearsIn('', source)).toBe(false)
})

test('normalizeUrl lowercases the host and strips fragments and trailing slashes', () => {
  expect(normalizeUrl('https://WWW.Example.com/Path/#frag')).toBe(
    'https://www.example.com/Path',
  )
  expect(normalizeUrl('https://example.com/')).toBe('https://example.com')
  expect(normalizeUrl('https://example.com/a/?x=1#top')).toBe('https://example.com/a/?x=1')
  expect(normalizeUrl('https://example.com/a/#top')).toBe('https://example.com/a')
})
