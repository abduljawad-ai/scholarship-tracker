import { gzipSync } from 'node:zlib'
import { expect, test } from 'vitest'
import { toIndexEntry } from '../../src/lib/filters'
import { loadPrograms } from '../../src/lib/data'

test('2,000-listing index stays under 300 KB gzipped', () => {
  const base = loadPrograms().map(toIndexEntry)
  const entries = Array.from({ length: 2000 }, (_, i) => ({
    ...base[i % base.length],
    programId: `p-${i}`,
    slug: `p-${i}`,
  }))
  expect(gzipSync(Buffer.from(JSON.stringify(entries))).byteLength).toBeLessThan(300 * 1024)
})
