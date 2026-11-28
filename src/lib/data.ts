// Build-time only: reads the seed JSON from disk. Never import this module
// from client scripts — import the pure selectors from "./selectors" instead.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseProgram, type Program } from "./schema"

export { activePrograms, archivedPrograms, isActive, nextCycle } from "./selectors"

// Vite bundles this module into dist/.prerender/chunks at build time, so
// import.meta.url no longer points at src/lib. Prefer the source tree from the
// project root and keep the module-relative path as a fallback.
const SOURCE_PROGRAMS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/programs",
)
const ROOT_PROGRAMS_DIR = path.resolve(process.cwd(), "src/data/programs")
const PROGRAMS_DIR = existsSync(ROOT_PROGRAMS_DIR) ? ROOT_PROGRAMS_DIR : SOURCE_PROGRAMS_DIR

/** Reads, parses and validates every `*.json` program file in `dir`. */
export function loadProgramsFrom(dir: string): Program[] {
  const filenames = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()

  const programs: Program[] = []
  const seen = new Map<string, string>() // programId -> filename

  for (const filename of filenames) {
    const filePath = path.join(dir, filename)

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

/** Reads the published seed data from `src/data/programs`. */
export function loadPrograms(): Program[] {
  return loadProgramsFrom(PROGRAMS_DIR)
}

/** Looks up a program by its `programId` slug. */
export function getProgram(
  programs: Program[],
  slug: string,
): Program | undefined {
  return programs.find((program) => program.programId === slug)
}
