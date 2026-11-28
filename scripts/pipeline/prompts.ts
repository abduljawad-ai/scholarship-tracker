// Prompt files are versioned in the repository. Loading them at runtime keeps
// prompt changes reviewable in git instead of buried in code.
import { readFileSync } from "node:fs"
import path from "node:path"

export function loadPrompt(name: string, dir: string): string {
  const filename = name.endsWith(".md") ? name : `${name}.md`
  return readFileSync(path.join(dir, filename), "utf8")
}

/** Replace every {{name}} placeholder; a missing variable is a bug, not a blank. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key]
    if (value === undefined) {
      throw new Error(`Missing prompt variable "${key}"`)
    }
    return value
  })
}
