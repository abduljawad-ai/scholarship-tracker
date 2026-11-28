// Pipeline configuration from the environment. Every path resolves against a
// root so tests and dry runs never touch the real repository.
import path from "node:path"
import type { AiTask, PipelineConfig, ProviderId, ProviderSettings } from "./types"

export const USER_AGENT =
  "ScholarshipTrackerBot/1.0 (+https://github.com/abduljawad-ai/scholarship-tracker)"

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"

export function loadConfig(
  env: Record<string, string | undefined>,
  root: string = process.cwd(),
): PipelineConfig {
  const providers: Partial<Record<ProviderId, ProviderSettings>> = {}

  if (env.GEMINI_API_KEY) {
    providers.gemini = {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    }
  }

  if (env.GROQ_API_KEY) {
    providers.groq = {
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    }
  }

  // Cloudflare and OpenRouter have no safe default model: an id that does not
  // exist fails every call, so both are configured only when named explicitly.
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_MODEL) {
    providers.cloudflare = {
      apiKey: env.CLOUDFLARE_API_TOKEN,
      model: env.CLOUDFLARE_MODEL,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
    }
  }

  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL) {
    providers.openrouter = {
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    }
  }

  const resolve = (relative: string): string => path.resolve(root, relative)
  const routing: Record<AiTask, ProviderId[]> = {
    extract: ["groq", "gemini"],
    "extract-long": ["gemini", "groq"],
    verify: ["gemini", "groq"],
    discover: ["groq", "gemini"],
  }

  return {
    dataDir: resolve("src/data/programs"),
    statePath: resolve("pipeline/state.json"),
    registryPath: resolve("pipeline/sources.json"),
    candidatesPath: resolve("pipeline/candidates.json"),
    runStatusPath: resolve("src/data/run-status.json"),
    reportsDir: resolve("pipeline/runs"),
    promptsDir: resolve("pipeline/prompts"),
    providers,
    routing,
    dailyCallLimit: 180,
    maxAttempts: 3,
    requestTimeoutMs: 60_000,
    userAgent: USER_AGENT,
  }
}
