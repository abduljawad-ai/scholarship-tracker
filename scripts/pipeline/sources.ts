// Source registry: the list of official pages the robot is allowed to read.
// Every entry names a known program; new programs are never invented here.
import { readFileSync } from "node:fs"
import { z } from "zod"
import type { SourceConfig } from "./types"

const HttpsUrl = z.string().regex(/^https:\/\/\S+$/, "expected an https URL")
const Slug = z.string().regex(/^[a-z0-9-]+$/, "expected a lowercase slug")

const SourceConfigSchema = z
  .object({
    sourceId: Slug,
    programId: Slug.nullable(),
    provider: z.string().min(1),
    officialHosts: z.array(z.string().min(1)).min(1),
    pageUrls: z.array(HttpsUrl).min(1),
    indexUrls: z.array(HttpsUrl),
    discovery: z.boolean(),
    archived: z.boolean(),
    mode: z.enum(["extract", "monitor"]).default("extract"),
  })
  .strict()

export function loadSources(file: string): SourceConfig[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot read source registry ${file}: ${message}`)
  }

  const parsed = z.array(SourceConfigSchema).safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid source registry ${file}: ${parsed.error.message}`)
  }

  const seen = new Set<string>()
  for (const source of parsed.data) {
    if (seen.has(source.sourceId)) {
      throw new Error(`Duplicate sourceId "${source.sourceId}" in ${file}`)
    }
    seen.add(source.sourceId)
  }

  return parsed.data
}
