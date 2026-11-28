// Run reports: machine-readable JSON for the repository, Markdown for the
// GitHub Actions job summary. Both are derived from the same RunReport.
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { PipelineConfig, RunReport } from "./types"

/** Write `pipeline/runs/<runId>.json` atomically and return its path. */
export function writeReport(config: PipelineConfig, report: RunReport): string {
  mkdirSync(config.reportsDir, { recursive: true })

  const filePath = path.join(config.reportsDir, `${report.runId}.json`)
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  renameSync(tempPath, filePath)
  return filePath
}

/** Markdown for `$GITHUB_STEP_SUMMARY`; short enough to read in one screen. */
export function renderSummary(report: RunReport): string {
  const lines = [
    `## Scholarship pipeline — ${report.status}`,
    "",
    `- Checked: ${report.checked}`,
    `- Published: ${report.published.length}`,
    `- Unchanged: ${report.unchanged.length}`,
    `- Failed: ${report.failed.length}`,
    `- Paused: ${report.paused.length}`,
    `- Review needed: ${report.review.length}`,
    `- Candidates: ${report.candidates}`,
    `- Unhealthy sources: ${report.unhealthy.length}`,
  ]

  if (report.discovery) {
    lines.push(
      `- Discovery: ${report.discovery.fetched} fetched, ${report.discovery.accepted} accepted (${report.discovery.stopReason})`,
    )
  }

  if (report.published.length > 0) {
    lines.push("", "### Published", ...report.published.map((item) => `- ${item}`))
  }
  if (report.failed.length > 0) {
    lines.push(
      "",
      "### Failed",
      ...report.failed.map((item) => `- ${item.item}: ${item.error}`),
    )
  }
  if (report.paused.length > 0) {
    lines.push("", "### Paused", ...report.paused.map((item) => `- ${item}`))
  }
  if (report.review.length > 0) {
    lines.push(
      "",
      "### Review needed",
      ...report.review.map((item) => `- ${item.sourceId}: ${item.url} (${item.reason})`),
    )
  }
  if (report.unhealthy.length > 0) {
    lines.push(
      "",
      "### Unhealthy sources",
      ...report.unhealthy.map((item) => `- ${item}`),
    )
  }
  if (report.discovery && report.discovery.errors.length > 0) {
    lines.push(
      "",
      "### Discovery errors",
      ...report.discovery.errors.map((item) => `- ${item}`),
    )
  }

  const providerEntries = Object.entries(report.providers)
  if (providerEntries.length > 0) {
    lines.push("", "### AI Providers")
    for (const [id, stats] of providerEntries) {
      let line = `- ${id}: ${stats.calls} calls, ${stats.errors} errors`
      if (stats.keys && Object.keys(stats.keys).length > 0) {
        const keyParts = Object.entries(stats.keys).map(
          ([lbl, k]) => `${lbl}: ${k.calls}${k.cooling ? " (cooling)" : ""}`,
        )
        line += ` [${keyParts.join(", ")}]`
      }
      lines.push(line)
    }
  }

  return `${lines.join("\n")}\n`
}
