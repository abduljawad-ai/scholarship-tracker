import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  ExtractionParseError,
  buildExtractRequest,
  extractScholarship,
  mergeExtractions,
  parseExtraction,
  splitTextIntoChunks,
  validateExtraction,
} from '../../scripts/pipeline/extract'
import { loadPrompt, renderPrompt } from '../../scripts/pipeline/prompts'
import type { Extraction, PageSnapshot, SourceConfig } from '../../scripts/pipeline/types'

const PAGE_URL = 'https://www.chevening.org/scholarships/'
const PAGE_TEXT = [
  'Chevening Scholarships applications open on 1 August 2027 and close on 3 November 2027.',
  'Apply at https://www.chevening.org/scholarships/apply/ before the deadline.',
  'You will need two reference letters and a statement of purpose.',
].join('\n')

const SOURCE: SourceConfig = {
  sourceId: 'chevening',
  programId: 'chevening-pakistan',
  provider: 'UK Foreign, Commonwealth and Development Office',
  officialHosts: ['chevening.org'],
  pageUrls: [PAGE_URL],
  indexUrls: [],
  discovery: false,
  archived: false,
  mode: 'extract',
}

const SNAPSHOT: PageSnapshot = {
  url: PAGE_URL,
  finalUrl: PAGE_URL,
  status: 200,
  contentType: 'text/html',
  hash: 'abc',
  text: PAGE_TEXT,
}

const PROMPTS_DIR = path.resolve('pipeline/prompts')

function validExtraction(): Extraction {
  return {
    pageKind: 'program',
    cycles: [
      {
        label: '2027/28 intake',
        status: null,
        dates: {
          opens: '2027-08-01',
          deadline: '2027-11-03',
          resultsDate: null,
          studyStart: null,
        },
        apply: {
          url: 'https://www.chevening.org/scholarships/apply/',
          portalName: 'Chevening',
          fee: null,
        },
        evidence: [
          {
            field: 'opens',
            quote: 'applications open on 1 August 2027',
            sourceUrl: PAGE_URL,
          },
          {
            field: 'deadline',
            quote: 'close on 3 November 2027',
            sourceUrl: PAGE_URL,
          },
          {
            field: 'applyUrl',
            quote: 'Apply at https://www.chevening.org/scholarships/apply/',
            sourceUrl: PAGE_URL,
          },
        ],
      },
    ],
    guide: null,
  }
}

test('renderPrompt replaces every variable and throws on a missing one', () => {
  expect(renderPrompt('A {{one}} B {{two}}', { one: '1', two: '2' })).toBe('A 1 B 2')
  expect(() => renderPrompt('A {{missing}}', {})).toThrow(/missing/)
})

test('loadPrompt reads a prompt file with or without the extension', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prompts-'))
  writeFileSync(path.join(dir, 'verify.md'), 'hello')

  expect(loadPrompt('verify', dir)).toBe('hello')
  expect(loadPrompt('verify.md', dir)).toBe('hello')
})

test('parseExtraction accepts JSON and strips json fences', () => {
  const raw = `\`\`\`json\n${JSON.stringify(validExtraction())}\n\`\`\``
  expect(parseExtraction(raw)).toEqual(validExtraction())
})

test('parseExtraction throws ExtractionParseError on invalid JSON or schema', () => {
  expect(() => parseExtraction('not json at all')).toThrow(ExtractionParseError)
  expect(() => parseExtraction('{"pageKind":"nope"}')).toThrow(ExtractionParseError)
  expect(() => parseExtraction('{"pageKind":"program","cycles":[],"guide":null,"extra":1}')).toThrow(
    ExtractionParseError,
  )
})

test('buildExtractRequest picks the long task and truncates at 60,000 characters', () => {
  const long = { ...SNAPSHOT, text: '§'.repeat(70_000) }
  const request = buildExtractRequest(SOURCE, long, PROMPTS_DIR)

  expect(request.task).toBe('extract-long')
  expect(request.temperature).toBe(0)
  expect(request.user).toContain('§'.repeat(60_000))
  expect(request.user).not.toContain('§'.repeat(60_001))
})

test('buildExtractRequest keeps short pages on the standard task', () => {
  const short = { ...SNAPSHOT, text: 'x'.repeat(10_000) }
  const request = buildExtractRequest(SOURCE, short, PROMPTS_DIR)

  expect(request.task).toBe('extract')
  expect(request.user).toContain('x'.repeat(10_000))
})

test('buildExtractRequest switches exactly above 24,000 characters', () => {
  expect(buildExtractRequest(SOURCE, { ...SNAPSHOT, text: 'a'.repeat(24_000) }, PROMPTS_DIR).task).toBe(
    'extract',
  )
  expect(buildExtractRequest(SOURCE, { ...SNAPSHOT, text: 'a'.repeat(24_001) }, PROMPTS_DIR).task).toBe(
    'extract-long',
  )
})

test('a valid extraction passes with no errors', () => {
  expect(validateExtraction(validExtraction(), SNAPSHOT, SOURCE)).toEqual([])
})

test('a deadline without deadline evidence is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.evidence = extraction.cycles[0]!.evidence.filter(
    (item) => item.field !== 'deadline',
  )

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/deadline/i)
})

test('an apply URL without applyUrl evidence is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.evidence = extraction.cycles[0]!.evidence.filter(
    (item) => item.field !== 'applyUrl',
  )

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/apply/i)
})

test('a status without status evidence is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.status = 'closed'

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/status/i)
})

test('a status with a quoted page sentence passes', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.status = 'closed'
  extraction.cycles[0]!.evidence.push({
    field: 'status',
    quote: 'Chevening Scholarships applications open on 1 August 2027 and close on 3 November 2027.',
    sourceUrl: PAGE_URL,
  })

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE)).toEqual([])
})

test('a quote that is not in the page text is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.evidence[1]!.quote = 'close on 9 December 2027'

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/quote/i)
})

test('an evidence source URL that is not the page URL is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.evidence[0]!.sourceUrl = 'https://evil.example/page'

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/source/i)
})

test('a program page with zero cycles is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles = []

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/cycle/i)
})

test('a non-program page is rejected for publishing', () => {
  const extraction = validExtraction()
  extraction.pageKind = 'index'

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/program page/i)
})

test('a guide item with no matching guide evidence is rejected', () => {
  const extraction = validExtraction()
  extraction.guide = {
    steps: ['Apply online'],
    documents: [],
    tips: [],
    timeline: [],
  }

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/guide/i)
})

test('a guide whose evidence is present passes', () => {
  const extraction = validExtraction()
  extraction.guide = {
    steps: ['Apply online'],
    documents: ['Two reference letters'],
    tips: [],
    timeline: [],
  }
  extraction.cycles[0]!.evidence.push(
    { field: 'guide.steps', quote: 'Apply at https://www.chevening.org/scholarships/apply/', sourceUrl: PAGE_URL },
    { field: 'guide.documents', quote: 'You will need two reference letters', sourceUrl: PAGE_URL },
  )

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE)).toEqual([])
})

test('a malformed ISO date is rejected', () => {
  const extraction = validExtraction()
  extraction.cycles[0]!.dates.deadline = '03/11/2027'

  expect(validateExtraction(extraction, SNAPSHOT, SOURCE).join(' ')).toMatch(/date/i)
})

test('splitTextIntoChunks returns single item if under chunkSize', () => {
  const text = 'Hello world, short scholarship text.'
  expect(splitTextIntoChunks(text, 100)).toEqual([text])
})

test('splitTextIntoChunks splits long text at paragraph boundaries', () => {
  const p1 = 'Paragraph 1: Scholarships open soon.\n\n'
  const p2 = 'Paragraph 2: Documents include degrees and certificates.\n\n'
  const p3 = 'Paragraph 3: Apply on the portal.'
  const full = p1 + p2 + p3

  const chunks = splitTextIntoChunks(full, 45, 10)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.join('')).toContain('Apply on the portal')
})

test('mergeExtractions combines cycles, preserves dates, and merges guides', () => {
  const base = validExtraction()
  const addition: Extraction = {
    pageKind: 'program',
    cycles: [
      {
        label: '2027/28 intake',
        status: null,
        dates: {
          opens: null,
          deadline: null,
          resultsDate: '2028-01-15',
          studyStart: '2028-09-01',
        },
        apply: {
          url: null,
          portalName: null,
          fee: 'Free',
        },
        evidence: [
          {
            field: 'resultsDate',
            quote: 'Results announced 15 January 2028',
            sourceUrl: PAGE_URL,
          },
        ],
      },
      {
        label: 'Spring 2028 intake',
        status: 'upcoming',
        dates: { opens: null, deadline: null, resultsDate: null, studyStart: null },
        apply: { url: 'https://example.com/spring', portalName: 'Spring Portal', fee: null },
        evidence: [],
      },
    ],
    guide: {
      steps: ['Attend interview'],
      documents: ['Medical fitness certificate'],
      tips: ['Prepare SOP early'],
      timeline: ['January 2028'],
    },
  }

  const merged = mergeExtractions(base, addition)
  expect(merged.cycles).toHaveLength(2)

  // Primary cycle should have merged dates and evidence
  const cycle1 = merged.cycles[0]!
  expect(cycle1.dates.opens).toBe('2027-08-01')
  expect(cycle1.dates.resultsDate).toBe('2028-01-15')
  expect(cycle1.apply.fee).toBe('Free')
  expect(cycle1.evidence).toHaveLength(4)

  // New cycle added
  expect(merged.cycles[1]!.label).toBe('Spring 2028 intake')

  // Guide merged
  expect(merged.guide?.steps).toContain('Attend interview')
  expect(merged.guide?.documents).toContain('Medical fitness certificate')
})

test('extractScholarship runs multi-chunk compaction loop when text is oversized', async () => {
  const chunk1Text = 'Part 1: Chevening applications open on 1 August 2027.'
  const chunk2Text = 'Part 2: Applications close on 3 November 2027. Apply at https://www.chevening.org/scholarships/apply/.'
  const combined = `${chunk1Text}\n\n${chunk2Text}`

  const snapshot: PageSnapshot = {
    ...SNAPSHOT,
    text: combined,
  }

  const calls: string[] = []
  const mockRouter = {
    available: () => ['groq' as const],
    complete: async (req: import('../../scripts/pipeline/types').AiRequest) => {
      calls.push(req.user)
      if (req.user.includes('Part 1')) {
        return {
          providerId: 'groq' as const,
          model: 'openai/gpt-oss-120b',
          text: JSON.stringify({
            pageKind: 'program',
            cycles: [
              {
                label: '2027 intake',
                status: null,
                dates: { opens: '2027-08-01', deadline: null, resultsDate: null, studyStart: null },
                apply: { url: null, portalName: null, fee: null },
                evidence: [{ field: 'opens', quote: 'open on 1 August 2027', sourceUrl: PAGE_URL }],
              },
            ],
            guide: null,
          }),
        }
      }

      // Chunk 2 response updating the extraction with deadline and apply
      return {
        providerId: 'groq' as const,
        model: 'openai/gpt-oss-120b',
        text: JSON.stringify({
          pageKind: 'program',
          cycles: [
            {
              label: '2027 intake',
              status: null,
              dates: { opens: '2027-08-01', deadline: '2027-11-03', resultsDate: null, studyStart: null },
              apply: { url: 'https://www.chevening.org/scholarships/apply/', portalName: null, fee: null },
              evidence: [
                { field: 'opens', quote: 'open on 1 August 2027', sourceUrl: PAGE_URL },
                { field: 'deadline', quote: 'close on 3 November 2027', sourceUrl: PAGE_URL },
                { field: 'applyUrl', quote: 'Apply at https://www.chevening.org/scholarships/apply/', sourceUrl: PAGE_URL },
              ],
            },
          ],
          guide: { steps: ['Apply online'], documents: [], tips: [], timeline: [] },
        }),
      }
    },
  }

  const { extraction, providerId } = await extractScholarship({
    source: SOURCE,
    snapshot,
    promptsDir: PROMPTS_DIR,
    router: mockRouter,
    chunkSize: 110, // Force split into 2 chunks
  })

  expect(calls).toHaveLength(2)
  expect(providerId).toBe('groq')
  expect(extraction.cycles[0]!.dates.opens).toBe('2027-08-01')
  expect(extraction.cycles[0]!.dates.deadline).toBe('2027-11-03')
  expect(extraction.cycles[0]!.apply.url).toBe('https://www.chevening.org/scholarships/apply/')
})
