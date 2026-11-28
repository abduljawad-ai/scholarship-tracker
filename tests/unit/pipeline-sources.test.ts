import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { loadSources } from '../../scripts/pipeline/sources'

function registryFile(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sources-'))
  const file = path.join(dir, 'sources.json')
  writeFileSync(file, JSON.stringify(content))
  return file
}

const VALID_SOURCE = {
  sourceId: 'chevening',
  programId: 'chevening-pakistan',
  provider: 'UK Foreign, Commonwealth and Development Office',
  officialHosts: ['chevening.org'],
  pageUrls: ['https://www.chevening.org/scholarships/'],
  indexUrls: ['https://www.chevening.org/scholarships/'],
  discovery: true,
  archived: false,
}

test('loads a valid registry', () => {
  const sources = loadSources(registryFile([VALID_SOURCE]))
  expect(sources).toHaveLength(1)
  expect(sources[0].sourceId).toBe('chevening')
})

test('defaults mode to extract and accepts monitor', () => {
  const monitor = { ...VALID_SOURCE, sourceId: 'monitor', mode: 'monitor' }
  const sources = loadSources(registryFile([VALID_SOURCE, monitor]))

  expect(sources[0]!.mode).toBe('extract')
  expect(sources[1]!.mode).toBe('monitor')
})

test('rejects an unknown mode', () => {
  const file = registryFile([{ ...VALID_SOURCE, mode: 'publish' }])
  expect(() => loadSources(file)).toThrow()
})

test('rejects a duplicate sourceId', () => {
  const file = registryFile([VALID_SOURCE, VALID_SOURCE])
  expect(() => loadSources(file)).toThrow(/duplicate/i)
})

test('rejects a non-HTTPS page URL', () => {
  const file = registryFile([
    { ...VALID_SOURCE, pageUrls: ['http://www.chevening.org/scholarships/'] },
  ])
  expect(() => loadSources(file)).toThrow(/https/i)
})

test('rejects an empty officialHosts list', () => {
  const file = registryFile([{ ...VALID_SOURCE, officialHosts: [] }])
  expect(() => loadSources(file)).toThrow()
})

test('rejects an unknown field', () => {
  const file = registryFile([{ ...VALID_SOURCE, extra: true }])
  expect(() => loadSources(file)).toThrow()
})

test('rejects a missing file with a readable error', () => {
  expect(() => loadSources('/nonexistent/pipeline/sources.json')).toThrow(/sources/i)
})
