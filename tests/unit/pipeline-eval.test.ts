import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { runEval } from '../../scripts/pipeline/eval'

const ROOT = process.cwd()

function copyRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pipeline-eval-'))
  cpSync(path.join(ROOT, 'pipeline'), path.join(root, 'pipeline'), { recursive: true })
  cpSync(path.join(ROOT, 'src/data'), path.join(root, 'src/data'), { recursive: true })
  return root
}

function fixture(root: string, name: string): string {
  return path.join(root, 'pipeline/fixtures', name)
}

test('the committed fixtures all pass', () => {
  const result = runEval(ROOT)

  expect(result.failed).toEqual([])
  expect(result.passed).toBe(4)
})

test('a quote that is not in the HTML fails the case', () => {
  const root = copyRepo()
  const file = fixture(root, 'chevening.extraction.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    cycles: Array<{ evidence: Array<{ field: string; quote: string }> }>
  }
  raw.cycles[0]!.evidence[0]!.quote = 'Applications open on 9 August 2027.'
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)

  const result = runEval(root)

  expect(result.failed).toContain('chevening-program')
})

test('invalid extraction JSON fails the case', () => {
  const root = copyRepo()
  writeFileSync(fixture(root, 'daad.extraction.json'), '{ not json')

  const result = runEval(root)

  expect(result.failed).toContain('daad-provisional')
})

test('a missing program file fails the case instead of throwing', () => {
  const root = copyRepo()
  const cases = JSON.parse(readFileSync(fixture(root, 'cases.json'), 'utf8')) as {
    cases: Array<{ id: string; programId?: string }>
  }
  const target = cases.cases.find((entry) => entry.id === 'chevening-program')
  target!.programId = 'does-not-exist'
  writeFileSync(fixture(root, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`)

  const result = runEval(root)

  expect(result.failed).toContain('chevening-program')
})