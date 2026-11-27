# Agentic scholarship discovery — research findings

Date: 2026-11-27
Scope: how a bounded, $0 discovery loop could find new Pakistani scholarship programs from official sources, and what to borrow from Venice.ai's agent tooling. No code was written and no other file was changed.

## Summary

- Venice's documented agent pattern is a client-side loop over search and scrape endpoints — search → select → scrape → cite; no hosted agent service is documented [2][4].
- The same docs ship a research-agent reference with bounded rounds, gap queries, URL/content dedupe, and source-balance checks — the most useful thing to copy [5].
- Venice cannot run this project at $0: `$0.01` per search, `$0.01` per scrape, and "no unmetered API tier" [6].
- None of the general web-search APIs checked offers a dependable perpetual free tier here. DuckDuckGo's HTML endpoint is disallowed by its own robots.txt [13]; Google's Programmable Search JSON API is closed to new customers and ends 2027-01-01 [12].
- Brave is credit-based, not free-forever: `$5 per 1,000 requests` with `$5 in free credits every month` on the 2026-11-22 snapshot — about 1,000 requests/month if the credit covers them [21].
- The reliable $0 backends are publisher-declared sitemaps/RSS [20], Wayback CDX/availability [16][18], and Common Crawl's CDX index [14].
- Archive and crawl indexes are for *finding* URLs only; facts must still come from the live official page or PDF, and Common Crawl's terms say not to rely on its content [15].
- The loop should be three bounded rounds with deterministic host/path scoring before any model call, batched classification, and hard caps on time, fetches, and calls [7][8].
- Discovery output is candidates only (`pipeline/candidates.json`, `pending-review`); nothing is published and `src/data/programs/` is never written (project rule: `AGENTS.md` §10).

## Venice.ai Observed/Inferred/Unknown

### Observed

- The API is OpenAI-compatible at `https://api.venice.ai/api/v1`; auth is a bearer key or an x402 wallet [1][2].
- `POST /augment/search` returns `title`, `url`, `content`, `date`; `query` is 1–400 characters and `limit` is 1–20 (default 10). Providers are `brave` (default), `google`, and `exa` [22].
- Search and scrape are "experimental APIs". Each has a per-minute request limit per account; over-limit requests return `429`, to be retried with exponential backoff and a small parallel pool [2].
- `POST /augment/scrape` returns Markdown. It first asks for the site's native Markdown representation (Cloudflare Markdown for Agents), then falls back to headless-browser extraction. X/Twitter and Reddit are rejected with `400` [23].
- The documented search-to-scrape workflow is: search → select sources by relevance, domain, and date → scrape only the pages you intend to use → store content with source URLs for citations [2].
- The cited-answers tutorial chains search and scrape into a chat completion where every claim resolves to a URL [4].
- The function-calling tutorial runs a real `max_rounds` loop (default 8). It exits when the model returns content instead of tool calls, and returns tool errors as ordinary results so the model can correct itself [3].
- The private research agent sets defaults of 3 iterations, 6 queries, 4 results per query, 40 sources maximum, and 6 chunks per source. It dedupes by canonical URL, then by content hash, and asks for gap output shaped as `{"gaps":[{"missing": "...", "why_it_matters": "...", "query": "..."}], "queries": ["..."]}` [5].
- It also reports source-cluster share by host so follow-up queries can broaden a captured source set instead of collecting more of the same domain [5].
- Pricing: web search on chat is `$10.00 per 1,000 requests`, scraping is `$10.00 per 1,000 URLs`, and `/augment/search` and `/augment/scrape` are `$0.01 per request`. "There is no unmetered API tier", and free accounts pay the same rates [6].

### Inferred

- "Agent mode" is most plausibly a product label over these same primitives — search, scrape, tool calling — rather than a separate orchestration service. No page named "agent mode" appeared in the documentation pages fetched [1][2][3][5].
- The loop is portable to free components because it is ordinary HTTP plus model calls; Venice's differentiator is provider routing and zero-data-retention search, not unique orchestration [2][22].
- Venice's research-agent defaults are a sensible starting point, but our 45-minute job and 180-call cap require smaller budgets than 40 sources × 6 chunks [5].

### Unknown

- Whether the venice.ai web client has a distinct "agent mode", how many rounds it runs, and whether it exposes a trace. The docs describe agents but do not document that UI surface [1][5].
- The numeric per-minute limits for search and scrape; the docs publish no numbers, though the API exposes `x-ratelimit-*` headers [2][24].
- Whether the ZDR/anonymized-provider claims hold independently; they are vendor statements, not third-party audited [2][22].
- Scrape success rates on Pakistani government and university hosts; nothing in the docs tests `.gov.pk` or `.edu.pk` sites [23].

## The loop pattern

- ReAct interleaves reasoning traces with actions that query external sources; the reasoning updates the plan and handles exceptions between actions [9].
- IRCoT shows the next retrieval depends on what has already been derived, so retrieval and reasoning must alternate rather than run as one search followed by one answer [10].
- Self-RAG makes retrieval adaptive and adds self-critique of retrieved passages and generated text, which improves factuality and citation accuracy [11].
- Anthropic separates workflows from agents and recommends orchestrator-workers for gathering from multiple sources, evaluator-optimizer when an evaluator decides whether more searching is warranted, and explicit stopping conditions such as a maximum iteration count [7].
- OpenAI's run loop exits on a final-output tool, a response with no tool calls, an error, or a maximum number of turns; guardrails and human intervention handle repeated failures and high-risk actions [8].
- Venice's research agent is a concrete implementation: plan queries → search → scrape → extract evidence → analyse gaps and source balance → follow-up queries → cited report, with artifacts for every step [5].
- For `discover.ts`, the transferable shape is: seed queries → retrieve URLs → deterministic prefilter → fetch and extract → classify in batches → measure coverage gaps → at most two gap-fill rounds → stop.
- The model should decide *what to look for next*, not *whether a fact is true*. Quote verification and host allow-lists stay deterministic [7][8].

## Free backend table

| Backend | Auth | $0 reality | Rules and caveats | Fit |
| --- | --- | --- | --- | --- |
| DuckDuckGo HTML (`/html`, `/lite`) | None | Free but not permitted | `robots.txt` says `Disallow: /html` and `Disallow: /lite` [13] | **Do not use** |
| Brave Search API | API key | `$5 per 1,000 requests`, `$5 in free credits every month` on the 2026-11-22 snapshot; hero copy also says "up to $20" — inconsistent, so treat it as credit, not a quota [21] | Direct site was unreachable from this environment; snapshot only. Storing results for a public database is **unverified** in the pages read [21] | Optional, credit-based |
| Google Programmable Search JSON | Key + engine ID | 100 queries/day, but "closed to new customers"; existing customers end 2027-01-01 [12] | Cannot be adopted for a new project [12] | **Ruled out** |
| Common Crawl CDX index | None | Free to query and download; bulk via columnar index [14] | "Please do not overload the URL index server." Terms prohibit harvesting PII and say not to rely on Crawled Content [14][15] | Discovery only |
| Wayback CDX + availability API | None | Free | Send a descriptive User-Agent, add delays, honour `429`/`Retry-After`, cache, use exponential backoff [17]. CDX supports `output=json`, `matchType`, `collapse`, `filter`, `limit`, and paginates; default cap is 150,000 rows [16]. Availability API is a single JSON lookup [18] | Discovery only |
| `sitemap.xml` | None | Free, publisher-declared | Max 50,000 URLs and 50 MB uncompressed per sitemap; sitemap indexes allowed; `Sitemap:` line in robots.txt [20] | Primary |
| RSS / Atom | None | Free, publisher-declared | No protocol-level guarantee that a feed exists; read feed URLs from `sources.json` or `<link rel="alternate">` | Primary when present |
| SearXNG | None if self-hosted | Self-hosting is the only reliable $0 path, but Actions cannot host it persistently | `format=json` must be enabled or the API returns `403`; "many public instances have these formats disabled" [19] | Not dependable in CI |

## Official-source discovery playbook

1. Start from hosts already trusted in `sources.json`. Use an aggregator only to learn a program name or host, then find the official page; never take a fact from the aggregator [15].
2. Prefer publisher-declared surfaces: `robots.txt` `Sitemap:` lines, `/sitemap.xml`, sitemap indexes, and RSS/Atom. They are cheap, publisher-sanctioned, and current [20].
3. Walk likely path vocabulary: `scholarship`, `scholarships`, `funding`, `bursary`, `award`, `grant`, `financial-aid`, `fees`, `admissions`, `prospectus`. Treat PDFs as first-class pages, not excluded file types: prospectuses and scholarship brochures are where deadline tables often live.
4. Enforce host identity before fetching: registrable domain must match `officialHosts`; reject lookalikes, shorteners, social posts, and aggregators. A `rel="nofollow"` link is still a lead, not a source.
5. Score the frontier deterministically: official host, path keyword, sitemap `lastmod`, query provenance, and whether the URL was seen before. Only the top slice reaches the model [7][8].
6. Extract only from live official HTML or PDF text. If a page is a JavaScript shell or under a minimum text length, reject it; Venice's scraper falls back to a headless browser for such pages, but our $0 fetcher cannot [23].
7. Use Wayback CDX to find removed or renamed scholarship pages, and the availability API to check a dead link. The archive copy locates the live page; it does not become the citation [16][18].
8. Use Common Crawl CDX for host/path discovery at scale, then verify the live URL. Its terms say the Crawled Content is not something to rely on, and PII harvesting is prohibited [14][15].
9. Be a polite client: `robots.txt` first, one request per host at a time, a descriptive User-Agent, delays, `429` backoff, and a cache. The existing `fetchText` already enforces robots and bounded retries; reuse it instead of writing a second fetcher (project input: `scripts/pipeline/fetch.ts`) [17].

## Proposed design for `discover.ts`

Goal: add new programs to `pipeline/candidates.json` as `pending-review`, with query provenance and evidence quotes, without touching published data.

Non-goals: no publishing, no `src/data/programs/` writes, no aggregator facts, no unbounded crawling, no browser rendering.

```ts
// Proposed shape, not implemented.
async function discover(router, sources, state, budgets, now) {
  const started = now()
  let queries = seedQueries(sources)                 // deterministic, no AI
  let queriesUsed = 0
  let fetchedSoFar = 0
  const reports: DiscoveryRoundReport[] = []

  for (let round = 1; round <= budgets.maxRounds; round++) {
    if (now() - started > budgets.deadlineMs) break

    const frontier: FrontierItem[] = []
    for (const query of queries.slice(0, budgets.maxQueriesPerRound)) {
      if (queriesUsed >= budgets.maxQueriesPerRun) break
      queriesUsed++
      for (const source of sources.filter((s) => s.discovery && !s.archived)) {
        const found = await collectUrls(source, query, budgets) // sitemap, RSS, CDX
        frontier.push(...found.map((url) => scoreFrontier(url, query, source)))
      }
    }

    const fresh = dedupeByUrl(frontier).filter((i) => !state.seenUrls[i.normalizedUrl])
    const remaining = budgets.maxFetchesPerRun - fetchedSoFar
    const shortlist = fresh.sort(byScoreDesc)
      .slice(0, Math.min(budgets.maxFetchesPerRound, remaining))

    const pages: PageSnapshot[] = []
    for (const item of shortlist) {
      if (now() - started > budgets.deadlineMs) break
      const page = await fetchOfficial(item.url)      // fetchText/fetchBytes + pdfToText
      fetchedSoFar++
      state.seenUrls[item.normalizedUrl] = { firstSeenAt: now(), status: page.status }
      if (page.text.length >= budgets.minTextLength) pages.push(page)
    }

    const verdicts = await classifyInBatches(router, pages, 10) // 1 call per 10 pages
    const accepted = verdicts.filter((v) => v.isScholarship && verifyQuotes(v, pages))
    saveCandidates(candidatesPath, mergeCandidates(loadCandidates(candidatesPath), accepted))

    const gaps = round < budgets.maxRounds
      ? await proposeGapQueries(router, reports, accepted, budgets) // 1 call per round
      : []
    queries = gaps

    reports.push({ round, queries, fetched: pages.length, accepted: accepted.length, gaps, stop: stopReason(...) })
    if (fresh.length === 0 || (accepted.length === 0 && gaps.length === 0)) break
  }
  return reports
}
```

Budgets for a 45-minute GitHub Actions job and a shared 180-call/day cap:

| Limit | Value | Reason |
| --- | --- | --- |
| Wall clock | 35 min soft stop, 40 min hard stop | Leaves checkout, install, and report time inside 45 min |
| Rounds | 3 (seed + two gap-fill) | Enough for IRCoT-style follow-up without wandering [10] |
| Queries | 6 per round, 18 per run | Mirrors Venice's 6-query default at a smaller scale [5] |
| URLs / fetches | 8 URLs collected per query; 40 pages fetched per run | Keeps the run inside the time budget on slow hosts |
| Concurrency | 2 global, 1 per host, ≥1 s between hits | Politeness and `429` avoidance [17] |
| AI classification | 10 pages per call, ≤30 `discover` calls/run | Batched to protect the 180/day cap |
| Gap analysis | 1 call per round, ≤2 per run | The only place a model chooses the next query |
| Candidates | 10 accepted per run, 50 pending total | Human review stays tractable |
| Fetch timeout / retries | 15 s, 3 attempts total, no retry on `403`/`404` | Tighter than the fetcher's 60 s default to protect the 45-minute budget |
| Stop conditions | No new URLs, no accepts and no gaps, any cap, deadline | Explicit stopping conditions are mandatory [7][8] |

Data shapes, extending the existing `Candidate` rather than replacing it:

```ts
interface DiscoveryQuery {
  id: string
  text: string
  round: number
  origin: "seed" | "gap"
  createdAt: string
}

interface DiscoveryState {
  seenUrls: Record<string, { firstSeenAt: string; status: number | null; contentHash?: string }>
  queries: DiscoveryQuery[]
  hostHealth: Record<string, { lastFetchAt: string | null; failures: number; nextEligibleAt: string | null }>
}

interface FrontierItem {
  url: string
  normalizedUrl: string
  host: string
  score: number
  foundByQueryId: string | null
  discoveredVia: "sitemap" | "rss" | "index" | "wayback-cdx" | "commoncrawl-cdx" | "search"
  lastmod: string | null
}

// BaseCandidate is the existing shape in scripts/pipeline/types.ts.
interface Candidate extends BaseCandidate {
  foundByQuery: string | null
  discoveredVia: FrontierItem["discoveredVia"]
  firstSeenAt: string
  discoveryScore: number
}

interface DiscoveryRoundReport {
  round: number
  queries: string[]
  fetched: number
  accepted: number
  gaps: string[]
  stopReason: "round-cap" | "deadline" | "no-new-urls" | "no-signal" | "call-cap" | null
}
```

Change from the current Task 9 plan: replace "index links plus sitemap, one LLM classify per link" with deterministic host/path prefilter, a scored frontier, and batched classification. Keep `extractSitemapLinks`, `parseCandidates`, `loadCandidates`, and `saveCandidates`; add `scoreFrontier`, `normalizeUrl`, and `mergeCandidates`. Persist seen URLs, query history, and per-host health in a `discovery` state block so runs resume instead of re-fetching. Keep `candidateId` stable and never write `src/data/programs/`.

## Risks and what NOT to do

- **Do not scrape DuckDuckGo HTML or Lite.** Its own robots.txt disallows both paths; a proxy or User-Agent swap does not make it allowed [13].
- **Do not build on Google Programmable Search.** It is closed to new customers and disappears on 2027-01-01 [12].
- **Do not treat Brave's monthly credit as a permanent free tier.** Measure actual credit consumption; the page contradicts itself between "$20" and "$5" [21].
- **Do not bypass CAPTCHAs, logins, or paywalls**, and do not spoof a browser User-Agent to get around a block [17][23].
- **Do not publish a candidate.** `candidates.json` is a review queue; only verified official evidence reaches `src/data/` (project rule: `AGENTS.md` §1, §10) [15].
- **Do not take facts from aggregators, social posts, or archive copies.** They may generate a lead; the quote must come from the live official page or PDF [15][18].
- **Do not let the model run unbounded.** Every loop needs a round cap, a time cap, and a call cap; Venice's own tutorial calls `max_rounds` "a real limit, not a formality" [3][7][8].
- **Do not spend a model call on every link.** Host/path filtering and dedupe are free; the daily call cap disappears quickly under per-link classification [5].
- **Do not invent or infer deadlines.** A missing deadline stays `null`; the UI shows "not confirmed", never a guessed date (project rule: `AGENTS.md` §1).
- **Do not hammer one host.** Serialise per host, cache responses, honour `429`/`Retry-After`, and stop on repeated failures [17].
- **Do not store personal data** found on pages, and do not use Common Crawl content in ways its terms prohibit [15].
- **Do not depend on a public SearXNG instance in CI.** JSON output is commonly disabled and instances rate-limit [19].
- **Do not copy Venice's reference search provider blindly.** Its research-agent tutorial queries DuckDuckGo directly, while DuckDuckGo's robots.txt disallows the HTML endpoint [5][13].

## Sources

1. Venice API documentation home — https://docs.venice.ai/
2. Venice, "Web Search and Scraping" — https://docs.venice.ai/guides/tools/web-retrieval.md
3. Venice, "Building a Tool-Using Agent with Function Calling" — https://docs.venice.ai/guides/features/tool-using-agent.md
4. Venice, "Cited Answers with Web Search" — https://docs.venice.ai/guides/tools/cited-web-answers.md
5. Venice, "Building a Private Research Agent" — https://docs.venice.ai/learn/private-research-agent.md
6. Venice, "Pricing" — https://docs.venice.ai/pricing.md
7. Anthropic, "Building effective agents" (2024-12-19) — https://www.anthropic.com/engineering/building-effective-agents
8. OpenAI, "A practical guide to building agents" (2026-01-15) — https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
9. Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models" — https://arxiv.org/abs/2210.03629
10. Trivedi et al., "Interleaving Retrieval with Chain-of-Thought Reasoning" (IRCoT) — https://arxiv.org/abs/2212.10509
11. Asai et al., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection" — https://arxiv.org/abs/2310.11511
12. Google, "Custom Search JSON API overview" — https://developers.google.com/custom-search/v1/overview
13. DuckDuckGo robots.txt — https://duckduckgo.com/robots.txt
14. Common Crawl, "Index Server" — https://index.commoncrawl.org/
15. Common Crawl, "Terms of Use" (2024-03-07) — https://commoncrawl.org/terms-of-use
16. Internet Archive, "Wayback CDX Server" README — https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
17. Internet Archive, "Bots, LLMs, and Automated Access" — https://archive.org/developers/bots.html
18. Internet Archive, Wayback availability API — https://archive.org/wayback/available?url=example.com
19. SearXNG, "Search API" — https://docs.searxng.org/dev/search_api.html
20. sitemaps.org, "Sitemaps XML format" — https://www.sitemaps.org/protocol.html
21. Brave Search API pricing, Wayback snapshot 2026-11-22 — http://web.archive.org/web/20261122123259/https://brave.com/search/api/ (live `brave.com` was unreachable from this environment)
22. Venice, "Web Search" API reference — https://docs.venice.ai/api-reference/endpoint/augment/search.md
23. Venice, "Web Scrape" API reference — https://docs.venice.ai/api-reference/endpoint/augment/scrape.md
24. Venice, "Agent Guide" — https://docs.venice.ai/agents.md

Project inputs (local files, not web sources): `AGENTS.md` (trust rules, $0, 180 calls/day, candidates only); `docs/superpowers/plans/2026-11-27-data-pipeline-harness.md` Task 9 (module interfaces, 45-minute job); `docs/superpowers/specs/2026-11-26-scholarship-tracker-design.md` §7–9b (pipeline standards and provider budgets).
