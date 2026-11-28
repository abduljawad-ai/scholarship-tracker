import { expect, test, vi } from 'vitest'

vi.mock('unpdf', () => ({
  extractText: vi.fn(async () => ({ totalPages: 2, text: 'PDF text here' })),
}))

import { extractLinks, htmlToText } from '../../scripts/pipeline/html'
import { pdfToText } from '../../scripts/pipeline/pdf'
import { extractText } from 'unpdf'

test('htmlToText drops scripts, styles, and svg, and keeps headings and list text', () => {
  const html = `
    <html>
      <head>
        <style>.hidden { color: red }</style>
        <script>alert('nope')</script>
      </head>
      <body>
        <h1>Hello &amp; welcome</h1>
        <p>First   paragraph.</p>
        <ul><li>One</li><li>Two</li></ul>
        <svg><text>icon label</text></svg>
        <noscript>enable js</noscript>
      </body>
    </html>
  `

  const text = htmlToText(html)

  expect(text).toContain('Hello & welcome')
  expect(text).toContain('First paragraph.')
  expect(text).toContain('One')
  expect(text).toContain('Two')
  expect(text).not.toContain('alert')
  expect(text).not.toContain('.hidden')
  expect(text).not.toContain('icon label')
  expect(text).not.toContain('enable js')
})

test('htmlToText collapses whitespace but keeps one break per block', () => {
  const text = htmlToText('<h2>Title</h2>\n\n  <p>Body   text</p><p>Next</p>')
  expect(text).toBe('Title\nBody text\nNext')
})

test('htmlToText decodes entities in text nodes', () => {
  expect(htmlToText('<p>Fees &amp; funding &#8212; 2027</p>')).toBe('Fees & funding — 2027')
})

test('extractLinks resolves relative links, strips fragments, and dedupes', () => {
  const html = `
    <a href="/a">A</a>
    <a href="b?x=1#frag">B</a>
    <a href="https://other.example/c">C</a>
    <a href="mailto:hi@example.com">Mail</a>
    <a href="#top">Top</a>
    <a href="/a">A again</a>
    <a>No href</a>
  `

  expect(extractLinks(html, 'https://example.com/base/')).toEqual([
    'https://example.com/a',
    'https://example.com/base/b?x=1',
    'https://other.example/c',
  ])
})

test('pdfToText asks unpdf for merged page text', async () => {
  const text = await pdfToText(new Uint8Array([1, 2, 3]))

  expect(text).toBe('PDF text here')
  expect(extractText).toHaveBeenCalledWith(expect.any(Uint8Array), { mergePages: true })
})
