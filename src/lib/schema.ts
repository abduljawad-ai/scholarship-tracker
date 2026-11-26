import { z } from "zod"
import {
  CYCLE_STATUSES,
  FUNDING_TYPES,
  PROVIDER_TYPES,
  SOURCE_TYPES,
  STUDY_LEVELS,
  VERIFICATION_STATUSES,
} from "./constants"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const HTTPS_URL_RE = /^https:\/\/\S+$/
const ANY_URL_RE = /^https?:\/\/\S+$/

const DateStr = z.string().regex(DATE_RE, "expected YYYY-MM-DD")
const DateOrNull = z.string().regex(DATE_RE, "expected YYYY-MM-DD").nullable()
const IsoDateTime = z.string().regex(ISO_DATETIME_RE, "expected ISO datetime")
const HttpsUrl = z.string().regex(HTTPS_URL_RE, "expected https URL")
const AnyUrl = z.string().regex(ANY_URL_RE, "expected http(s) URL")

export const CycleSchema = z
  .object({
    cycleId: z.string().min(1),
    label: z.string().min(1),
    dates: z
      .object({
        opens: DateOrNull,
        deadline: DateOrNull,
        resultsDate: DateOrNull,
        studyStart: DateOrNull,
      })
      .strict(),
    status: z.enum(CYCLE_STATUSES),
    apply: z
      .object({
        url: AnyUrl.nullable(),
        portalName: z.string().nullable(),
        fee: z.string().nullable(),
      })
      .strict(),
    verification: z
      .object({
        deadline: z.enum(VERIFICATION_STATUSES),
        applyUrl: z.enum(VERIFICATION_STATUSES),
        funding: z.enum(VERIFICATION_STATUSES),
        eligibility: z.enum(VERIFICATION_STATUSES),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            url: HttpsUrl,
            type: z.enum(SOURCE_TYPES),
            lastVerified: DateStr,
          })
          .strict(),
      )
      .min(1),
    evidence: z
      .array(
        z
          .object({
            field: z.string().min(1),
            quote: z.string().min(1),
            sourceUrl: HttpsUrl,
          })
          .strict(),
      ),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export const ProgramSchema = z
  .object({
    programId: z.string().regex(/^[a-z0-9-]+$/, "expected lowercase slug"),
    title: z.string().min(1),
    provider: z.string().min(1),
    providerType: z.enum(PROVIDER_TYPES),
    country: z.string().min(1),
    officialUrl: HttpsUrl,
    fundedLevels: z.array(z.enum(STUDY_LEVELS)).min(1),
    applicantStages: z.array(z.enum(STUDY_LEVELS)).min(1),
    fields: z.array(z.string()),
    eligibility: z
      .object({
        nationalities: z.array(z.string()),
        ageMax: z.number().nullable(),
        minDegree: z.enum(STUDY_LEVELS).nullable(),
        minMarks: z.string().nullable(),
        englishTest: z.string().nullable(),
        experienceYears: z.number().nullable(),
        other: z.array(z.string()),
      })
      .strict(),
    funding: z
      .object({
        type: z.enum(FUNDING_TYPES),
        tuitionCovered: z.boolean(),
        monthlyStipend: z.number().nullable(),
        currency: z.string().nullable(),
        otherBenefits: z.array(z.string()),
      })
      .strict(),
    guide: z
      .object({
        steps: z.array(z.string()),
        documents: z.array(z.string()),
        tips: z.array(z.string()),
        timeline: z.array(z.string()),
      })
      .strict(),
    cycles: z.array(CycleSchema).min(1),
    firstSeen: IsoDateTime,
    lastUpdated: IsoDateTime,
  })
  .strict()

export type Cycle = z.infer<typeof CycleSchema>
export type Program = z.infer<typeof ProgramSchema>

export function parseProgram(input: unknown): Program {
  return ProgramSchema.parse(input)
}
