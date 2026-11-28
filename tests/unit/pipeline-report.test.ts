import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { loadConfig } from '../../scripts/pipeline/config'
import { renderSummary, writeReport } from '../../scripts/pipeline/report'
import type { RunReport } from '../../scripts/pipeline/types'

function report(): RunReport {
  return {
    runId: '2026-11-27T06-00-00-000Z',
    startedAt: '2026-11-27T06:00:00.000Z',
    finishedAt: '2026-11-27T06:01:00.000Z',
    status: 'complete',
    published: ['chevening-pakistan'],
    unchanged: ['hec-need-based'],
    skipped: ['sindh-matric::https://www.sindh.gov.pk/'],
    failed: [{ item: 'fulbright::https://www.usefp.org/', error: 'HTTP 500' }],
    paused: [],
    unhealthy: ['daad'],
    candidates: 2,
    checked: 3,
    sources: {
      chevening: { fetched: 1, published: 1, failed: 0 },
      fulbright: { fetched: 1, published: 0, failed: 1 },
    },
    providers: { groq: { calls: 4, errors: 0, cooldowns: 0 } },
    discovery: {
      rounds: [
        {
          round: 1,
          queries: ['Example Foundation scholarship'],
          fetched: 2,
          accepted: 1,
          gaps: [],
          stopReason: 'round-cap',
        },
      ],
      fetched: 2,
      accepted: 1,
      queries: ['Example Foundation scholarship'],
      stopReason: 'round-cap',
      errors: ['https://example.org/sitemap.xml: HTTP 404'],
    },
  }
}

test('writeReport writes valid JSON atomically and leaves no temp file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pipeline-report-'))
  const config = loadConfig({}, root)
  const input = report()

  const file = writeReport(config, input)

  expect(file).toBe(path.join(config.reportsDir, `${input.runId}.json`))
  expect(readdirSync(config.reportsDir)).toEqual([`${input.runId}.json`])
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(input)
})

test('renderSummary reports counts and lists the outcomes', () => {
  const markdown = renderSummary(report())

  expect(markdown).toContain('Scholarship pipeline — complete')
  expect(markdown).toContain('Checked: 3')
  expect(markdown).toContain('Published: 1')
  expect(markdown).toContain('Unchanged: 1')
  expect(markdown).toContain('Failed: 1')
  expect(markdown).toContain('Candidates: 2')
  expect(markdown).toContain('- chevening-pakistan')
  expect(markdown).toContain('- fulbright::https://www.usefp.org/: HTTP 500')
  expect(markdown).toContain('### Unhealthy sources')
  expect(markdown).toContain('- daad')
  expect(markdown).toContain('Discovery: 2 fetched, 1 accepted (round-cap)')
  expect(markdown).toContain('### Discovery errors')
  expect(markdown).toContain('- https://example.org/sitemap.xml: HTTP 404')
})
