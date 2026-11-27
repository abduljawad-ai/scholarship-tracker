import type { Cycle, Program } from "./schema"

/** A cycle is "live" when its status is open or upcoming. */
function isLiveCycle(cycle: Cycle): boolean {
  return cycle.status === "open" || cycle.status === "upcoming"
}

/** A program is active when any of its cycles is open or upcoming. */
export function isActive(program: Program): boolean {
  return program.cycles.some(isLiveCycle)
}

/**
 * The next cycle to act on: among open|upcoming cycles, the one with the
 * earliest non-null deadline. Cycles with a null deadline sort after dated
 * ones; ties keep array order. If every live cycle has a null deadline,
 * returns the first live cycle. Returns undefined when there is no
 * open|upcoming cycle.
 *
 * Pure and status-driven — no wall clock.
 */
export function nextCycle(program: Program): Cycle | undefined {
  const live = program.cycles.filter(isLiveCycle)
  const dated = live.filter((c) => c.dates.deadline !== null)
  if (dated.length > 0) {
    return dated.reduce((best, c) =>
      c.dates.deadline! < best.dates.deadline! ? c : best,
    )
  }
  return live[0]
}

function byTitle(a: Program, b: Program): number {
  return a.title.localeCompare(b.title)
}

/** Programs with at least one open|upcoming cycle, sorted by title. */
export function activePrograms(programs: Program[]): Program[] {
  return programs.filter(isActive).sort(byTitle)
}

/** Programs with no open|upcoming cycle (closed/archived), sorted by title. */
export function archivedPrograms(programs: Program[]): Program[] {
  return programs.filter((p) => !isActive(p)).sort(byTitle)
}
