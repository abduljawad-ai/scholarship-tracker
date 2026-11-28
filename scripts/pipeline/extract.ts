// Extraction: build the prompt, parse the model's JSON, and reject anything
// the page does not support. This is the first trust gate; verification is the
// second.
import { z } from "zod"
import { loadPrompt, renderPrompt } from "./prompts"
import { normalizeUrl, quoteAppearsIn } from "./text"
import type { AiRequest, Extraction, PageSnapshot, SourceConfig } from "./types"

export class ExtractionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtractionParseError"
  }
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

const EvidenceSchema = z
  .object({
    field: z.string().min(1),
    quote: z.string().min(1),
    sourceUrl: z.string().min(1),
  })
  .strict()

const ExtractedCycleSchema = z
  .object({
    label: z.string().min(1),
    dates: z
      .object({
        opens: IsoDate.nullable(),
        deadline: IsoDate.nullable(),
        resultsDate: IsoDate.nullable(),
        studyStart: IsoDate.nullable(),
      })
      .strict(),
    apply: z
      .object({
        url: z.string().nullable(),
        portalName: z.string().nullable(),
        fee: z.string().nullable(),
      })
      .strict(),
    evidence: z.array(EvidenceSchema),
  })
  .strict()

const GuideSchema = z
  .object({
    steps: z.array(z.string()),
    documents: z.array(z.string()),
    tips: z.array(z.string()),
    timeline: z.array(z.string()),
  })
  .strict()

export const ExtractionSchema = z
  .object({
    pageKind: z.enum(["program", "index", "unknown"]),
    cycles: z.array(ExtractedCycleSchema),
    guide: GuideSchema.nullable(),
  })
  .strict()

const LONG_PAGE_THRESHOLD = 24_000
const PAGE_LIMITS = { extract: 24_000, "extract-long": 60_000 } as const

const EXTRACT_SYSTEM =
  "You extract scholarship facts from one official page. Return JSON only. Never invent or infer a value."

export function buildExtractRequest(
  source: SourceConfig,
  snapshot: PageSnapshot,
  promptsDir: string,
): AiRequest {
  const task = snapshot.text.length > LONG_PAGE_THRESHOLD ? "extract-long" : "extract"
  const template = loadPrompt("extract", promptsDir)
  const user = renderPrompt(template, {
    provider: source.provider,
    sourceUrl: snapshot.finalUrl,
    pageText: snapshot.text.slice(0, PAGE_LIMITS[task]),
  })

  return { task, system: EXTRACT_SYSTEM, user, temperature: 0, maxOutputTokens: 4096 }
}

export function parseExtraction(text: string): Extraction {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end <= start) {
    throw new ExtractionParseError("No JSON object found in the model output")
  }

  let raw: unknown
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ExtractionParseError(`Invalid JSON from the model: ${message}`)
  }

  const parsed = ExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ExtractionParseError(`Extraction schema violation: ${parsed.error.message}`)
  }
  return parsed.data
}

const DATE_FIELDS = ["opens", "deadline", "resultsDate", "studyStart"] as const
const GUIDE_FIELDS = ["steps", "documents", "tips", "timeline"] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Every error is a reason not to publish. An empty array means the extraction
 * is structurally sound and every fact points at a quote on the page.
 */
export function validateExtraction(
  extraction: Extraction,
  snapshot: PageSnapshot,
  _source: SourceConfig,
): string[] {
  const errors: string[] = []

  if (extraction.pageKind !== "program") {
    errors.push(`Page is not a program page (pageKind: ${extraction.pageKind})`)
  }
  if (extraction.cycles.length === 0) {
    errors.push("Program page has no cycles")
  }

  const pageUrl = normalizeUrl(snapshot.finalUrl)

  for (const cycle of extraction.cycles) {
    for (const evidence of cycle.evidence) {
      if (!quoteAppearsIn(evidence.quote, snapshot.text)) {
        errors.push(
          `Evidence quote for "${evidence.field}" is not in the page text: "${evidence.quote}"`,
        )
      }
      if (normalizeUrl(evidence.sourceUrl) !== pageUrl) {
        errors.push(
          `Evidence source for "${evidence.field}" points at ${evidence.sourceUrl}, not ${snapshot.finalUrl}`,
        )
      }
    }

    const fields = new Set(cycle.evidence.map((item) => item.field))

    for (const field of DATE_FIELDS) {
      const value = cycle.dates[field]
      if (value === null) continue
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
        errors.push(`Cycle "${cycle.label}" has an invalid ${field} date: ${value}`)
      }
      if (!fields.has(field)) {
        errors.push(`Cycle "${cycle.label}" has a ${field} date with no ${field} evidence`)
      }
    }

    if (cycle.apply.url !== null) {
      if (!cycle.apply.url.startsWith("https://")) {
        errors.push(`Cycle "${cycle.label}" has a non-HTTPS apply URL: ${cycle.apply.url}`)
      }
      if (!fields.has("applyUrl")) {
        errors.push(`Cycle "${cycle.label}" has an apply URL with no applyUrl evidence`)
      }
    }
  }

  if (extraction.guide) {
    for (const field of GUIDE_FIELDS) {
      const items = extraction.guide[field].filter((item) => item.trim().length > 0)
      if (items.length === 0) continue

      const evidenceField = `guide.${field}`
      const supported = extraction.cycles.some((cycle) =>
        cycle.evidence.some((evidence) => evidence.field === evidenceField),
      )
      if (!supported) {
        errors.push(`Guide ${field} have no ${evidenceField} evidence`)
      }
    }
  }

  return errors
}
