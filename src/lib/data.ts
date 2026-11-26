// Build-time only: reads the seed JSON from disk. Never import this module
// from client scripts — import the pure selectors from "./selectors" instead.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseProgram, type Program } from "./schema"

export { activePrograms, archivedPrograms, isActive, nextCycle } from "./selectors"

const PROGRAMS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/programs",
)

/** Reads, parses and validates every `src/data/programs/*.json` seed file. */
export function loadPrograms(): Program[] {
  const filenames = readdirSync(PROGRAMS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()

  const programs: Program[] = []
  const seen = new Map<string, string>() // programId -> filename

  for (const filename of filenames) {
    const filePath = path.join(PROGRAMS_DIR, filename)

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, "utf8"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid program file ${filename}: ${message}`)
    }

    let program: Program
    try {
      program = parseProgram(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid program file ${filename}: ${message}`)
    }

    const existing = seen.get(program.programId)
    if (existing !== undefined) {
      throw new Error(
        `Duplicate programId "${program.programId}" in ${filename} (already defined in ${existing})`,
      )
    }
    seen.set(program.programId, filename)
    programs.push(program)
  }

  return programs
}

/** Looks up a program by its `programId` slug. */
export function getProgram(
  programs: Program[],
  slug: string,
): Program | undefined {
  return programs.find((program) => program.programId === slug)
}
