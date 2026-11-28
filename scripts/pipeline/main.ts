// CLI entry point for the daily pipeline. Kept separate from run.ts so tests
// can import the argument parser without starting a run.
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { parseArgs as nodeParseArgs } from "node:util"
import { loadConfig } from "./config"
import { renderSummary } from "./report"
import { createRouter } from "./router"
import { runPipeline } from "./run"
import { createFileStore, createMemoryStore } from "./state"

export interface CliOptions {
  maxItems: number
  sourceId?: string
  dryRun: boolean
  live: boolean
  discovery: boolean
}

export function parseArgs(argv: string[]): CliOptions {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      "max-items": { type: "string" },
      source: { type: "string" },
      "dry-run": { type: "boolean" },
      live: { type: "boolean" },
      "no-discovery": { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  })

  const rawMaxItems = values["max-items"]
  const maxItems = rawMaxItems === undefined ? 20 : Number(rawMaxItems)
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error("--max-items must be a positive integer")
  }

  return {
    maxItems,
    sourceId: values.source,
    dryRun: values["dry-run"] ?? false,
    live: values.live ?? false,
    discovery: !(values["no-discovery"] ?? false),
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const options = parseArgs(argv)
  const config = loadConfig(env)

  if (Object.keys(config.providers).length === 0) {
    console.log("No AI providers configured — pipeline skipped.")
    return 0
  }

  const baseStore = createFileStore(config.statePath)
  const store = options.dryRun ? createMemoryStore(baseStore.get()) : baseStore
  const router = createRouter({ config, store })

  const result = await runPipeline({
    config,
    router,
    store,
    fetchImpl: fetch,
    now: new Date(),
    dryRun: options.dryRun,
    maxItems: options.maxItems,
    sourceId: options.sourceId,
    allowLive: options.live,
    discovery: options.discovery,
  })

  const summary = renderSummary(result.report)
  console.log(summary)

  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  }

  return result.summary.status === "failed" ? 1 : 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
