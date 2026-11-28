// Pipeline configuration from the environment. Every path resolves against a
// root so tests and dry runs never touch the real repository.
import path from "node:path"
import type {
  AiTask,
  PipelineConfig,
  ProviderId,
  ProviderKeyConfig,
  ProviderSettings,
} from "./types"

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
      keys: [{ label: "gemini:1", apiKey: env.GEMINI_API_KEY }],
    }
  }

  const groqKeys: ProviderKeyConfig[] = []
  const seenGroqKeys = new Set<string>()

  const addGroqKey = (rawKey: string, preferredLabel?: string) => {
    const trimmed = rawKey.trim()
    if (!trimmed || seenGroqKeys.has(trimmed)) return
    seenGroqKeys.add(trimmed)
    const label = preferredLabel ?? `groq:${groqKeys.length + 1}`
    groqKeys.push({ label, apiKey: trimmed })
  }

  // 1. Delimited list of keys in GROQ_API_KEYS (supports comma, semicolon, or newline separated keys)
  if (env.GROQ_API_KEYS) {
    for (const part of env.GROQ_API_KEYS.split(/[\r\n,;]+/)) {
      addGroqKey(part)
    }
  }

  // 2. Scan all numbered keys GROQ_API_KEY_<number> dynamically with no upper limit
  const numberedGroqIndices: number[] = []
  for (const varName of Object.keys(env)) {
    const match = /^GROQ_API_KEY_(\d+)$/.exec(varName)
    if (match) {
      numberedGroqIndices.push(parseInt(match[1]!, 10))
    }
  }
  numberedGroqIndices.sort((a, b) => a - b)
  for (const idx of numberedGroqIndices) {
    const val = env[`GROQ_API_KEY_${idx}`]
    if (val) addGroqKey(val, `groq:${idx}`)
  }

  // 3. Legacy single GROQ_API_KEY
  if (env.GROQ_API_KEY) {
    addGroqKey(env.GROQ_API_KEY, groqKeys.length === 0 ? "groq:1" : "groq:default")
  }

  if (groqKeys.length > 0) {
    providers.groq = {
      apiKey: groqKeys[0]!.apiKey,
      model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      keys: groqKeys,
    }
  }

  // Cloudflare and OpenRouter have no safe default model: an id that does not
  // exist fails every call, so both are configured only when named explicitly.
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_MODEL) {
    providers.cloudflare = {
      apiKey: env.CLOUDFLARE_API_TOKEN,
      model: env.CLOUDFLARE_MODEL,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      keys: [{ label: "cloudflare:1", apiKey: env.CLOUDFLARE_API_TOKEN }],
    }
  }

  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL) {
    providers.openrouter = {
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      keys: [{ label: "openrouter:1", apiKey: env.OPENROUTER_API_KEY }],
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
