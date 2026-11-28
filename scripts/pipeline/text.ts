// Text normalization shared by extraction validation and verification.
// Quote checks are intentionally forgiving about typography (smart quotes,
// dashes, line breaks) but strict about the words and numbers themselves.
const FOLD: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2212": "-",
  "\u00a0": " ",
  "\u2026": "...",
}

function foldAscii(value: string): string {
  return value.replace(/[\u2010-\u201f\u2212\u00a0\u2026]/g, (char) => FOLD[char] ?? char)
}

/** Lowercase, ASCII-ish punctuation, single spaces. Used only for comparison. */
export function normalizeText(value: string): string {
  return foldAscii(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/\-. ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when the quote appears in the source after normalization. */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const needle = normalizeText(quote)
  if (!needle) return false
  return normalizeText(sourceText).includes(needle)
}

/** Canonical URL for equality checks: lowercase host, no fragment, no trailing slash. */
export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ""
    const out = url.toString()
    return out.endsWith("/") ? out.slice(0, -1) : out
  } catch {
    return value.trim()
  }
}
