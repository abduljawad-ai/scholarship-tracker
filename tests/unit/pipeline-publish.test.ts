import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { parseProgram, type Program } from '../../src/lib/schema'
import {
  cycleIdFromLabel,
  mergeExtraction,
  setRunStatusLive,
  writeProgramFile,
  type MergeOptions,
} from '../../scripts/pipeline/publish'
import type { Extraction, SourceConfig } from '../../scripts/pipeline/types'

const PAGE_URL = 'https://example.org/scholarships/'
const APPLY_URL = 'https://example.org/apply/'

const SOURCE: SourceConfig = {
  sourceId: 'test-source',
  programId: 'test-program',
  provider: 'Test Provider',
  officialHosts: ['example.org'],
  pageUrls: [PAGE_URL],
  indexUrls: [],
  discovery: false,
  archived: false,
}

function baseProgram(): Program {
  return {
    programId: 'test-program',
    title: 'Test Scholarship',
    provider: 'Test Provider',
    providerType: 'gov',
    country: 'Pakistan',
    officialUrl: 'https://example.org/',
    fundedLevels: ['master'],
    applicantStages: ['bachelor'],
    fields: ['All subjects'],
    eligibility: {
      nationalities: ['PK'],
      ageMax: null,
      minDegree: null,
      minMarks: null,
      englishTest: null,
      experienceYears: null,
      other: [],
    },
    funding: {
      type: 'fully-funded',
      tuitionCovered: true,
      monthlyStipend: null,
      currency: null,
      otherBenefits: [],
    },
    guide: { steps: [], documents: [], tips: [], timeline: [] },
    cycles: [
      {
        cycleId: '2027',
        label: '2027/28 intake',
        dates: {
          opens: '2027-08-01',
          deadline: '2027-11-03',
          resultsDate: null,
          studyStart: null,
        },
        status: 'upcoming',
        apply: { url: APPLY_URL, portalName: 'Portal', fee: null },
        verification: {
          deadline: 'verified',
          applyUrl: 'verified',
          funding: 'verified',
          eligibility: 'verified',
        },
        sources: [
          { url: PAGE_URL, type: 'official-page', lastVerified: '2026-11-20' },
        ],
        evidence: [
          { field: 'deadline', quote: 'old deadline quote', sourceUrl: PAGE_URL },
        ],
        confidence: 1,
      },
    ],
    firstSeen: '2026-11-18T00:00:00.000Z',
    lastUpdated: '2026-11-20T00:00:00.000Z',
  }
}

function baseExtraction(overrides: Partial<Extraction['cycles'][number]> = {}): Extraction {
  const cycle = {
    label: '2027/28 intake',
    dates: {
      opens: '2027-08-01',
      deadline: '2027-12-01',
      resultsDate: null,
      studyStart: null,
    },
    apply: { url: 'https://example.org/apply-2027/', portalName: 'Portal 2027', fee: 'Free' },
    evidence: [
      { field: 'deadline', quote: 'close on 1 December 2027', sourceUrl: PAGE_URL },
      { field: 'applyUrl', quote: 'Apply at https://example.org/apply-2027/', sourceUrl: PAGE_URL },
    ],
    ...overrides,
  }

  return { pageKind: 'program', cycles: [cycle], guide: null }
}

function options(overrides: Partial<MergeOptions> = {}): MergeOptions {
  return {
    today: '2026-11-27',
    now: new Date('2026-11-27T06:00:00.000Z'),
    verifiedFields: new Set(['deadline', 'applyUrl']),
    guideVerified: false,
    ...overrides,
  }
}

test('cycleIdFromLabel prefers the first year in the label', () => {
  expect(cycleIdFromLabel('2027/28 intake', null)).toBe('2027')
  expect(cycleIdFromLabel('Intake 2028-29', null)).toBe('2028')
  expect(cycleIdFromLabel('Autumn intake', '2029-01-01')).toBe('2029')
})

test('a new cycle is appended and existing cycles are untouched', () => {
  const program = baseProgram()
  const original = structuredClone(program)
  const extraction = baseExtraction({
    label: '2028/29 intake',
    dates: {
      opens: '2028-08-01',
      deadline: '2028-11-03',
      resultsDate: null,
      studyStart: null,
    },
    apply: { url: 'https://example.org/apply-2028/', portalName: null, fee: null },
  })

  const merged = mergeExtraction(program, extraction, SOURCE, options())

  expect(merged.cycles).toHaveLength(2)
  expect(merged.cycles[0]).toEqual(original.cycles[0])
  expect(merged.cycles[1]!.cycleId).toBe('2028')
  expect(merged.firstSeen).toBe(original.firstSeen)
  expect(merged.lastUpdated).toBe('2026-11-27T06:00:00.000Z')
})

test('a cycle with the same cycleId is updated, not duplicated', () => {
  const merged = mergeExtraction(baseProgram(), baseExtraction(), SOURCE, options())

  expect(merged.cycles).toHaveLength(1)
  expect(merged.cycles[0]!.cycleId).toBe('2027')
  expect(merged.cycles[0]!.dates.deadline).toBe('2027-12-01')
})

test('a null extracted date keeps the existing date', () => {
  const extraction = baseExtraction({
    dates: {
      opens: null,
      deadline: null,
      resultsDate: null,
      studyStart: null,
    },
  })

  const merged = mergeExtraction(baseProgram(), extraction, SOURCE, options())

  expect(merged.cycles[0]!.dates.deadline).toBe('2027-11-03')
  expect(merged.cycles[0]!.dates.opens).toBe('2027-08-01')
})

test('a verified deadline updates the date and the verification label', () => {
  const program = baseProgram()
  program.cycles[0]!.verification.deadline = 'provisional'

  const merged = mergeExtraction(program, baseExtraction(), SOURCE, options())

  expect(merged.cycles[0]!.dates.deadline).toBe('2027-12-01')
  expect(merged.cycles[0]!.verification.deadline).toBe('verified')
})

test('a provisional deadline never replaces an existing verified deadline', () => {
  const merged = mergeExtraction(
    baseProgram(),
    baseExtraction(),
    SOURCE,
    options({ verifiedFields: new Set() }),
  )

  expect(merged.cycles[0]!.dates.deadline).toBe('2027-11-03')
  expect(merged.cycles[0]!.verification.deadline).toBe('verified')
})

test('a provisional deadline updates an unverified cycle and stays provisional', () => {
  const program = baseProgram()
  program.cycles[0]!.verification.deadline = 'unverified'

  const merged = mergeExtraction(
    program,
    baseExtraction(),
    SOURCE,
    options({ verifiedFields: new Set() }),
  )

  expect(merged.cycles[0]!.dates.deadline).toBe('2027-12-01')
  expect(merged.cycles[0]!.verification.deadline).toBe('provisional')
})

test('opens updates only when verified', () => {
  const extraction = baseExtraction({
    dates: {
      opens: '2027-07-01',
      deadline: '2027-12-01',
      resultsDate: null,
      studyStart: null,
    },
  })

  const unverified = mergeExtraction(
    baseProgram(),
    extraction,
    SOURCE,
    options({ verifiedFields: new Set() }),
  )
  expect(unverified.cycles[0]!.dates.opens).toBe('2027-08-01')

  const verified = mergeExtraction(
    baseProgram(),
    extraction,
    SOURCE,
    options({ verifiedFields: new Set(['opens']) }),
  )
  expect(verified.cycles[0]!.dates.opens).toBe('2027-07-01')
})

test('a verified apply URL replaces the old one', () => {
  const merged = mergeExtraction(baseProgram(), baseExtraction(), SOURCE, options())

  expect(merged.cycles[0]!.apply.url).toBe('https://example.org/apply-2027/')
  expect(merged.cycles[0]!.verification.applyUrl).toBe('verified')
})

test('an unverified apply URL never replaces a verified URL', () => {
  const merged = mergeExtraction(
    baseProgram(),
    baseExtraction(),
    SOURCE,
    options({ verifiedFields: new Set() }),
  )

  expect(merged.cycles[0]!.apply.url).toBe(APPLY_URL)
  expect(merged.cycles[0]!.verification.applyUrl).toBe('verified')
})

test('the guide is replaced only when it was verified', () => {
  const extraction = baseExtraction()
  extraction.guide = {
    steps: ['Apply online'],
    documents: ['Passport'],
    tips: [],
    timeline: [],
  }

  const kept = mergeExtraction(
    baseProgram(),
    extraction,
    SOURCE,
    options({ guideVerified: false }),
  )
  expect(kept.guide.steps).toEqual([])

  const replaced = mergeExtraction(
    baseProgram(),
    extraction,
    SOURCE,
    options({ guideVerified: true }),
  )
  expect(replaced.guide.steps).toEqual(['Apply online'])
  expect(replaced.guide.documents).toEqual(['Passport'])
})

test('status is derived from the merged dates', () => {
  const base = baseProgram()

  expect(
    mergeExtraction(base, baseExtraction(), SOURCE, options({ today: '2027-01-01' })).cycles[0]!
      .status,
  ).toBe('upcoming')
  expect(
    mergeExtraction(base, baseExtraction(), SOURCE, options({ today: '2027-11-03' })).cycles[0]!
      .status,
  ).toBe('open')
  expect(
    mergeExtraction(base, baseExtraction(), SOURCE, options({ today: '2027-12-02' })).cycles[0]!
      .status,
  ).toBe('closed')
})

test('an archived cycle stays archived', () => {
  const program = baseProgram()
  program.cycles[0]!.status = 'archived'

  const merged = mergeExtraction(program, baseExtraction(), SOURCE, options())

  expect(merged.cycles[0]!.status).toBe('archived')
})

test('identity fields are unchanged', () => {
  const program = baseProgram()
  const merged = mergeExtraction(program, baseExtraction(), SOURCE, options())

  for (const key of [
    'programId',
    'title',
    'provider',
    'country',
    'officialUrl',
    'fundedLevels',
    'applicantStages',
    'eligibility',
    'funding',
    'firstSeen',
  ] as const) {
    expect(merged[key], key).toEqual(program[key])
  }
})

test('the source entry is refreshed and evidence is merged by field', () => {
  const extraction = baseExtraction()
  extraction.cycles[0]!.evidence.push({
    field: 'opens',
    quote: 'applications open on 1 August 2027',
    sourceUrl: PAGE_URL,
  })

  const merged = mergeExtraction(baseProgram(), extraction, SOURCE, options())
  const cycle = merged.cycles[0]!

  expect(cycle.sources).toEqual([
    { url: PAGE_URL, type: 'official-page', lastVerified: '2026-11-27' },
  ])
  expect(cycle.evidence.find((item) => item.field === 'deadline')!.quote).toBe(
    'close on 1 December 2027',
  )
  expect(cycle.evidence.find((item) => item.field === 'opens')!.quote).toBe(
    'applications open on 1 August 2027',
  )
  expect(cycle.confidence).toBe(1)
})

test('confidence is the fraction of verified deadline and apply URL fields', () => {
  const program = baseProgram()
  program.cycles[0]!.apply.url = null
  program.cycles[0]!.verification.applyUrl = 'unverified'

  const merged = mergeExtraction(
    program,
    baseExtraction(),
    SOURCE,
    options({ verifiedFields: new Set(['deadline']) }),
  )

  expect(merged.cycles[0]!.confidence).toBe(1)

  const unverifiedDeadline = baseProgram()
  unverifiedDeadline.cycles[0]!.verification.deadline = 'unverified'
  const half = mergeExtraction(
    unverifiedDeadline,
    baseExtraction(),
    SOURCE,
    options({ verifiedFields: new Set() }),
  )
  expect(half.cycles[0]!.confidence).toBe(0.5)
})

test('writeProgramFile writes valid JSON atomically and leaves no temp file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'programs-'))

  writeProgramFile(baseProgram(), dir)

  const files = readdirSync(dir)
  expect(files).toEqual(['test-program.json'])
  expect(files.some((name) => name.endsWith('.tmp'))).toBe(false)

  const raw = readFileSync(path.join(dir, 'test-program.json'), 'utf8')
  expect(raw.endsWith('\n')).toBe(true)
  expect(parseProgram(JSON.parse(raw)).programId).toBe('test-program')
})

test('setRunStatusLive writes live mode and an ISO timestamp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-status-'))
  const file = path.join(dir, 'run-status.json')
  writeFileSync(file, JSON.stringify({ mode: 'sample', lastSuccessfulRun: null }))

  setRunStatusLive(file, new Date('2026-11-27T06:00:00.000Z'))

  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
    mode: 'live',
    lastSuccessfulRun: '2026-11-27T06:00:00.000Z',
  })
  expect(readdirSync(dir)).toEqual(['run-status.json'])
})
