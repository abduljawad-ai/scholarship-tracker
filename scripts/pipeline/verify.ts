// Two-model verification. Deterministic checks run first; only facts that pass
// them are sent to a second provider. A single failed fact never throws: it is
// marked provisional with the reason, and the run continues.
import { z } from "zod"
import { isPlausibleDeadline, quoteSupportsDate } from "./dates"
import type { FetchLike } from "./http"
import { loadPrompt, renderPrompt } from "./prompts"
import { quoteAppearsIn } from "./text"
import { checkApplyUrl, isAllowedApplyUrl } from "./urls"
import type { AiRequest, EvidenceFact, PageSnapshot, ProviderId, Router } from "./types"

export interface VerifiableFact extends EvidenceFact {
  value: string
}

export interface VerifyOptions {
  officialHosts?: string[]
  today?: string
  fetchImpl?: FetchLike
}

export interface VerifyResult {
  status: "verified" | "provisional"
  reason: string
}

export class VerificationParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VerificationParseError"
  }
}

const VerificationSchema = z
  .object({
    agreed: z.boolean(),
    quote: z.string().min(1).nullable(),
    reason: z.string().min(1),
  })
  .strict()

const DATE_FIELDS = new Set(["opens", "deadline", "resultsDate", "studyStart"])

const VERIFY_SYSTEM =
  "You verify one extracted fact against one official page. Return JSON only. Never use outside knowledge."

const PAGE_LIMIT = 40_000

export function buildVerifyRequest(
  fact: VerifiableFact,
  snapshot: PageSnapshot,
  promptsDir: string,
): AiRequest {
  const template = loadPrompt("verify", promptsDir)
  const user = renderPrompt(template, {
    field: fact.field,
    value: fact.value,
    quote: fact.quote,
    sourceUrl: fact.sourceUrl,
    pageText: snapshot.text.slice(0, PAGE_LIMIT),
  })

  return { task: "verify", system: VERIFY_SYSTEM, user, temperature: 0, maxOutputTokens: 1024 }
}

export function parseVerification(text: string): {
  agreed: boolean
  quote: string | null
  reason: string
} {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end <= start) {
    throw new VerificationParseError("No JSON object found in the verifier output")
  }

  let raw: unknown
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new VerificationParseError(`Invalid JSON from the verifier: ${message}`)
  }

  const parsed = VerificationSchema.safeParse(raw)
  if (!parsed.success) {
    throw new VerificationParseError(`Verifier schema violation: ${parsed.error.message}`)
  }
  return parsed.data
}

function provisional(reason: string): VerifyResult {
  return { status: "provisional", reason }
}

/**
 * Verify one fact. Returns `verified` only when every deterministic check and
 * the second model agree. Any doubt is `provisional`, never a thrown error.
 */
export async function verifyFact(
  router: Router,
  fact: VerifiableFact,
  snapshot: PageSnapshot,
  primaryProviderId: ProviderId,
  promptsDir: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!quoteAppearsIn(fact.quote, snapshot.text)) {
    return provisional("The extractor quote is not in the source text")
  }

  if (DATE_FIELDS.has(fact.field)) {
    if (!quoteSupportsDate(fact.quote, fact.value)) {
      return provisional(`The quote does not support the date ${fact.value}`)
    }
    if (
      fact.field === "deadline" &&
      options.today !== undefined &&
      !isPlausibleDeadline(fact.value, options.today)
    ) {
      return provisional(`The deadline ${fact.value} is not plausible from ${options.today}`)
    }
  }

  if (fact.field === "applyUrl") {
    const hosts = options.officialHosts ?? []
    if (hosts.length > 0 && !isAllowedApplyUrl(fact.value, hosts)) {
      return provisional("The apply URL is not on an official host")
    }

    const check = await checkApplyUrl(fact.value, hosts, options.fetchImpl)
    if (!check.ok) {
      return provisional(check.reason)
    }
  }

  if (router.available("verify", [primaryProviderId]).length === 0) {
    return provisional("No second provider is available to verify this fact")
  }

  let response
  try {
    response = await router.complete(buildVerifyRequest(fact, snapshot, promptsDir), {
      exclude: [primaryProviderId],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return provisional(`The second provider failed: ${message}`)
  }

  let verification
  try {
    verification = parseVerification(response.text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return provisional(message)
  }

  if (!verification.agreed) {
    return provisional(verification.reason)
  }
  if (verification.quote === null || !quoteAppearsIn(verification.quote, snapshot.text)) {
    return provisional("The verifier quote is not in the source text")
  }

  if (DATE_FIELDS.has(fact.field)) {
    if (!quoteSupportsDate(verification.quote, fact.value)) {
      return provisional(`The verifier quote does not support the date ${fact.value}`)
    }
  } else if (fact.field === "applyUrl") {
    if (!quoteAppearsIn(fact.value, verification.quote)) {
      return provisional("The verifier quote does not contain the apply URL")
    }
  }

  return { status: "verified", reason: verification.reason }
}
