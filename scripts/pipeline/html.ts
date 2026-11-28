// HTML -> plain text and links. The extraction prompt reasons over text, so
// this is the only place HTML structure matters.
import { parse, type HTMLElement, type Node } from "node-html-parser"

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template", "iframe"])

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
])

function collect(node: Node, out: string[]): void {
  // 3 is the DOM text-node type; everything else that is not an element is
  // a comment or declaration and carries no publishable text.
  if (node.nodeType === 3) {
    out.push(node.text)
    return
  }
  if (node.nodeType !== 1) return

  const element = node as HTMLElement
  const tag = (element.rawTagName ?? "").toLowerCase()
  if (SKIP_TAGS.has(tag)) return

  const block = BLOCK_TAGS.has(tag)
  if (block) out.push("\n")
  for (const child of element.childNodes) collect(child, out)
  if (block) out.push("\n")
}

/** Visible page text: entities decoded, block breaks kept, whitespace calm. */
export function htmlToText(html: string): string {
  const root = parse(html, { comment: false })
  const out: string[] = []
  collect(root, out)

  return out
    .join("")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
}

const NON_WEB_PROTOCOLS = /^(mailto:|tel:|javascript:|data:)/i

/**
 * Absolute, unique links from one HTML page. Fragments are dropped and only
 * http(s) URLs survive; callers decide which hosts and paths are allowed.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const root = parse(html, { comment: false })
  const links = new Set<string>()

  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href")?.trim()
    if (!href || href.startsWith("#") || NON_WEB_PROTOCOLS.test(href)) continue

    try {
      const url = new URL(href, baseUrl)
      if (url.protocol !== "https:" && url.protocol !== "http:") continue
      url.hash = ""
      links.add(url.toString())
    } catch {
      // A malformed href is a dead end, not a reason to fail the page.
    }
  }

  return [...links]
}
