// Extraction: build the prompt, parse the model's JSON, and reject anything
// the page does not support. This is the first trust gate; verification is the
// second.
import { z } from "zod"
import { loadPrompt, renderPrompt } from "./prompts"
import { normalizeUrl, quoteAppearsIn } from "./text"
import type {
  AiRequest,
  ExtractedCycle,
  Extraction,
  Guide,
  PageSnapshot,
  ProviderId,
  Router,
  SourceConfig,
} from "./types"

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
    label: z.string().min(1).nullable(),
    status: z.enum(["open", "upcoming", "closed"]).nullable().default(null),
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

export function splitTextIntoChunks(
  text: string,
  chunkSize = 20_000,
  overlap = 500,
): string[] {
  if (text.length <= chunkSize) return [text]

  const safeOverlap = Math.min(overlap, Math.floor(chunkSize / 4))
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    let end = start + chunkSize
    if (end >= text.length) {
      chunks.push(text.slice(start))
      break
    }

    const lookback = Math.min(1000, Math.floor(chunkSize / 2))
    const windowStart = Math.max(start, end - lookback)
    const searchWindow = text.slice(windowStart, end)
    const paragraphBreak = searchWindow.lastIndexOf("\n\n")

    if (paragraphBreak !== -1) {
      end = windowStart + paragraphBreak + 2
      chunks.push(text.slice(start, end))
      start = end
    } else {
      const lineBreak = searchWindow.lastIndexOf("\n")
      if (lineBreak !== -1) {
        end = windowStart + lineBreak + 1
        chunks.push(text.slice(start, end))
        start = end
      } else {
        chunks.push(text.slice(start, end))
        start = Math.max(start + 1, end - safeOverlap)
      }
    }
  }

  return chunks
}

export function buildCompactionRequest(
  source: SourceConfig,
  chunkText: string,
  partNumber: number,
  totalParts: number,
  previousExtraction: Extraction | null,
  promptsDir: string,
): AiRequest {
  if (!previousExtraction || partNumber === 1) {
    const template = loadPrompt("extract", promptsDir)
    const user = renderPrompt(template, {
      provider: source.provider,
      sourceUrl: source.pageUrls[0] || "",
      pageText: chunkText,
    })
    return {
      task: "extract",
      system: EXTRACT_SYSTEM,
      user,
      temperature: 0,
      maxOutputTokens: 4096,
    }
  }

  const user = [
    `# PARTIAL UPDATE: Part ${partNumber} of ${totalParts}`,
    `Provider: ${source.provider}`,
    `Source URL: ${source.pageUrls[0] || ""}`,
    "",
    "## PREVIOUS EXTRACTED STATE (from earlier parts of this document)",
    "```json",
    JSON.stringify(previousExtraction, null, 2),
    "```",
    "",
    `## NEW SECTION TEXT (part ${partNumber} of ${totalParts})`,
    chunkText,
    "",
    "## INSTRUCTIONS",
    "1. Merge and update the extracted state with any new cycles, dates, apply URLs, evidence quotes, or guide items from this section.",
    "2. If an existing cycle is completed or clarified, update its fields.",
    "3. Keep all verified facts from earlier sections unless this section explicitly supersedes them.",
    "4. Return the complete, updated JSON object following the required schema.",
  ].join("\n")

  return {
    task: "extract",
    system: EXTRACT_SYSTEM,
    user,
    temperature: 0,
    maxOutputTokens: 4096,
  }
}

export function mergeExtractions(base: Extraction, addition: Extraction): Extraction {
  const pageKind = addition.pageKind === "program" ? "program" : base.pageKind

  const mergedCycles: ExtractedCycle[] = [...base.cycles]

  for (const newCycle of addition.cycles) {
    const matchIndex = mergedCycles.findIndex(
      (c) =>
        (c.label !== null &&
          newCycle.label !== null &&
          c.label.toLowerCase() === newCycle.label.toLowerCase()) ||
        (c.apply.url !== null && newCycle.apply.url !== null && c.apply.url === newCycle.apply.url),
    )

    if (matchIndex === -1) {
      mergedCycles.push(newCycle)
    } else {
      const existing = mergedCycles[matchIndex]!
      const dates = {
        opens: newCycle.dates.opens ?? existing.dates.opens,
        deadline: newCycle.dates.deadline ?? existing.dates.deadline,
        resultsDate: newCycle.dates.resultsDate ?? existing.dates.resultsDate,
        studyStart: newCycle.dates.studyStart ?? existing.dates.studyStart,
      }
      const apply = {
        url: newCycle.apply.url ?? existing.apply.url,
        portalName: newCycle.apply.portalName ?? existing.apply.portalName,
        fee: newCycle.apply.fee ?? existing.apply.fee,
      }
      const evidence = [...existing.evidence]
      for (const ev of newCycle.evidence) {
        if (!evidence.some((e) => e.field === ev.field && e.quote === ev.quote)) {
          evidence.push(ev)
        }
      }
      mergedCycles[matchIndex] = {
        label: newCycle.label ?? existing.label,
        status: newCycle.status ?? existing.status,
        dates,
        apply,
        evidence,
      }
    }
  }

  let guide: Guide | null = null
  if (base.guide || addition.guide) {
    const baseGuide = base.guide ?? { steps: [], documents: [], tips: [], timeline: [] }
    const addGuide = addition.guide ?? { steps: [], documents: [], tips: [], timeline: [] }
    const dedup = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]))
    guide = {
      steps: dedup(baseGuide.steps, addGuide.steps),
      documents: dedup(baseGuide.documents, addGuide.documents),
      tips: dedup(baseGuide.tips, addGuide.tips),
      timeline: dedup(baseGuide.timeline, addGuide.timeline),
    }
  }

  return {
    pageKind,
    cycles: mergedCycles,
    guide,
  }
}

export interface ExtractOptions {
  source: SourceConfig
  snapshot: PageSnapshot
  promptsDir: string
  router: Router
  chunkSize?: number
}

export async function extractScholarship(
  options: ExtractOptions,
): Promise<{ extraction: Extraction; providerId: ProviderId; keyLabel?: string }> {
  const { source, snapshot, promptsDir, router, chunkSize = 20_000 } = options

  const chunks = splitTextIntoChunks(snapshot.text, chunkSize)

  if (chunks.length <= 1) {
    const request = buildExtractRequest(source, snapshot, promptsDir)
    const response = await router.complete(request)
    const extraction = parseExtraction(response.text)
    return {
      extraction,
      providerId: response.providerId,
      keyLabel: response.keyLabel,
    }
  }

  let currentExtraction: Extraction | null = null
  let lastProviderId: ProviderId = "groq"
  let lastKeyLabel: string | undefined

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const request = buildCompactionRequest(
      source,
      chunk,
      i + 1,
      chunks.length,
      currentExtraction,
      promptsDir,
    )

    const response = await router.complete(request)
    lastProviderId = response.providerId
    lastKeyLabel = response.keyLabel

    const parsed = parseExtraction(response.text)
    currentExtraction = currentExtraction ? mergeExtractions(currentExtraction, parsed) : parsed
  }

  return {
    extraction: currentExtraction!,
    providerId: lastProviderId,
    keyLabel: lastKeyLabel,
  }
}

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
        errors.push(`Cycle "${cycle.label ?? "(unnamed)"}" has an invalid ${field} date: ${value}`)
      }
      if (!fields.has(field)) {
        errors.push(`Cycle "${cycle.label ?? "(unnamed)"}" has a ${field} date with no ${field} evidence`)
      }
    }

    if (cycle.apply.url !== null) {
      if (!cycle.apply.url.startsWith("https://")) {
        errors.push(`Cycle "${cycle.label ?? "(unnamed)"}" has a non-HTTPS apply URL: ${cycle.apply.url}`)
      }
      if (!fields.has("applyUrl")) {
        errors.push(`Cycle "${cycle.label ?? "(unnamed)"}" has an apply URL with no applyUrl evidence`)
      }
    }

    if (cycle.status !== null && !fields.has("status")) {
      errors.push(`Cycle "${cycle.label ?? "(unnamed)"}" has a status with no status evidence`)
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
