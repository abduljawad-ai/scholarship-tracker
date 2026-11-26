# Scholarship Tracker — Design

**Status:** Approved 2026-11-26; amended 2026-11-27 with admin site, provider
strategy, automation hardening, and plan split
**Last updated:** 2026-11-27
**Owner:** Jawad
**Approach:** A — static site + daily robot (locked)

> Single source of truth for this project. This file always describes the project
> as it stands right now — edited in place as decisions are made, never a diary.
> Build plans are written directly from this file.

---

## 1. Intent and why

Students in Pakistan — especially Sindh — miss scholarships they were eligible for
because opportunities are scattered across dozens of sites and deadlines pass
silently. This project is one free, always-current board: a daily robot collects
scholarships from the web, AI turns each into a structured listing **with a
step-by-step application guide built from official sources**, and anyone with the
link can filter by their level and apply through the official page.

Nobody posts listings by hand. No public accounts are needed. A separate,
protected admin site lets the owner review, correct, and control the robot.

## 2. Success criteria

- A student finds at least one scholarship they would have missed, and applies
- 30+ days unattended with **zero wrong deadlines published** (accuracy over volume)
- Loads in under ~2 seconds on a mid-range phone on mobile data
- Runs at **$0** with no surprise bills
- Family and friends use it without being taught; later shareable with college friends
- Admin can review low-confidence items and fix a listing in minutes, without code

## 3. Audience and access

- Students in Pakistan, focus Sindh; all levels (matric → PhD); any destination
  (including staying in Pakistan)
- First users: family and friends; later possibly college friends / wider community
- Public read-only site: anyone with the link can browse; no public sign-ups
- Admin: owner + trusted helpers, protected separately

## 4. Goals, non-goals, anti-goals

### Goals

- Cover scholarships relevant to Pakistani applicants, refreshed daily
- Level filter, eligible-only view, sort by newest / best funding / deadline soonest
- Every listing has a verified "how to apply" guide and a direct official link
- Keep past/closed scholarships in an archive
- AI integrated in the pipeline and available as an on-site assistant
- Separate admin site for review, corrections, run control, and source health
- $0 running cost, 24/7 availability

### Non-goals (v1)

- Hosting applications — we link to official pages only
- Manual, job-board-style posting (admin edits are exceptions, not the workflow)
- Social network features (public comments/forums)
- Real-time updates — daily cadence is agreed
- Literal global completeness — "every" means every listing across chosen sources
- Public user accounts

### Anti-goals (failure even if the site works)

- A wrong deadline that makes someone miss a real one
- AI-invented eligibility rules presented as fact
- A site that goes down, slows to a crawl, or starts costing money
- Needing manual updates to stay useful
- Heavy, cluttered pages on a slow connection
- An admin panel that can silently corrupt published data

## 5. What v1 includes

1. **Daily auto-updated listings** — scheduled job collects, AI structures,
   verifies, and republishes the site
2. **Level filter** — matric, intermediate, bachelor's, master's, PhD (+ all)
3. **Eligible-only toggle** — honest, conservative (see section 6)
4. **Sorting** — newest first; best funding first; deadline soonest
5. **Listing page with a verified guide** — see section 6
6. **Apply button** — straight to the official application page
7. **Archive** — past/closed scholarships, browsable and searchable
8. **AI assistant** — "am I eligible?", "what documents do I need?", grounded in
   listing data and official evidence
9. **My Applications tracker** — on-device: save, status, notes, deadline countdown
10. **Report a problem** — prefilled GitHub issue, no backend needed
11. **Share button** — WhatsApp-friendly link to any listing
12. **Freshness banner** — shown automatically if the last successful refresh is
    older than ~36 hours
13. **Admin control room** — separate, protected app: review queue, run control,
    source health, provider health, corrections

## 6. The guide, eligibility, and trust rules

### The guide on every scholarship

Each listing answers, in plain language:

- **How to apply** — numbered steps (create account, forms, documents, fee,
  submit, interview), derived from the official page or its guidelines PDF
- **Where to apply** — verified official application URL + portal name
- **Documents needed** — checklist (transcripts, attestation, IELTS, references…)
- **Eligibility** — nationality, age limit, degree level, minimum marks/GPA,
  English test, experience
- **Timeline** — opens, deadline, results, study start
- **Funding** — tuition coverage, monthly stipend, allowances, travel
- **Official sources** — links used, with a **last verified** date
- **Trust label** — "Summarized from official sources on <date>; always confirm on
  the official page"

### What "eligible" means in v1 (honest, conservative)

- Each listing stores two things separately: **what it funds** (matric,
  intermediate, bachelor's, master's, PhD) and **who may apply** (applicant stage)
- The "I'm currently in…" selector maps to applicant stages: matric →
  intermediate/foundation programs; intermediate → bachelor's; bachelor's →
  master's; master's → PhD; PhD → postdoc/fellowships. An explicit level filter
  overrides this
- "Eligible only" checks: applicant stage match + open to Pakistani nationals +
  age limit if stated + status open/upcoming
- The label is **"Likely eligible — based on level, nationality and age. Check the
  marks and English requirements below."** Never "you qualify" as fact
- Marks/English/experience are shown as requirements but **not auto-checked** in
  v1 (no personal profile)

### Verification rules

- **Per fact, not per listing.** Deadline, apply link, funding, and eligibility
  claims each carry a verification status: `verified` | `provisional` | `unverified`
- **An unverified deadline is never shown as a date.** It shows "Deadline not
  confirmed — check official page"
- A **verified** deadline must match date text found in the official page/PDF
- Apply link must resolve (HTTPS, HTTP 200) and belong to the official domain or
  its linked portal; otherwise no Apply button is shown
- Eligibility claims must map to quoted evidence stored with the listing
- Low-confidence listings are shown only with a **"Check official page"** badge,
  never as verified

### Source tiers (and the exceptions that matter)

| Tier | What it is | How it's treated |
|---|---|---|
| 1 | Official page or PDF, fetched successfully | Can be `verified` |
| 2 | Official source but bot-blocked (403), HTTP-only, image-only PDF, or announced only on an official Facebook page | `provisional`; manual review allowed; evidence required |
| 3 | Aggregator, blog, search result | Discovery only — never the final source |

Strict tier-1-only rules would exclude many real Sindh/local opportunities, so
tier 2 exists with a visible badge. A dead or unverifiable apply link is never
presented as an Apply button.

### Sourcing rule

- Discovery may come from aggregators or search — but **every published fact must
  trace to an official source** (provider/government/university page or PDF)
- Guides are AI-written summaries *of official material*, never invented

## 7. Data model

```ts
Program {
  programId,                 // stable slug: provider + program name; never includes a deadline
  title, provider, providerType,        // gov | university | foundation | org
  country, officialUrl,
  fundedLevels[],            // what the scholarship pays for
  applicantStages[],         // who may apply
  fields[],
  eligibility: {
    nationalities[], ageMax, minDegree, minMarks,
    englishTest, experienceYears, other[]
  },
  funding: {
    type, tuitionCovered, monthlyStipend, currency, otherBenefits[]
  },
  guide: { steps[], documents[], tips[], timeline[] },
  cycles: [{                 // one per intake/year
    cycleId, label,          // e.g. "2027 intake"
    dates: { opens, deadline, resultsDate, studyStart },
    status,                  // open | upcoming | closed | archived
    apply: { url, portalName, fee },
    verification: { deadline, applyUrl, funding, eligibility },  // verified|provisional|unverified
    sources: [{ url, type, lastVerified }],
    evidence: [{ field, quote, sourceUrl }],
    confidence
  }],
  firstSeen, lastUpdated
}
```

**Identity and lifecycle**

- `programId` never contains a deadline; extensions update the same cycle instead
  of creating a duplicate
- Dedupe matches canonical apply URL first, then provider + normalized title
- Old URLs redirect to the stable program page; archive keeps per-cycle pages
  labelled "closed — for reference"
- Tracker entries store `programId` + `cycleId`, so saved items survive new cycles
  and show "archived" when their cycle closes

## 8. Data pipeline (agent standards)

**Schedule:** daily, early morning Pakistan time (GitHub Actions cron), plus a
manual "run now" trigger from the admin site.

**Sources (seed list, builder extends):**

- Official programs: HEC, Chevening, Fulbright/USEFP, DAAD, Erasmus Mundus,
  Türkiye Bursları, Chinese Government (CSC), Commonwealth, Australia Awards,
  MEXT, GKS, plus university-specific funding pages
- Discovery only: official sitemaps/RSS first; Brave Search API where its free
  quota allows; aggregators where robots.txt/ToS allow
- AI discovery sweep for anything new

**Agent behavior (a careful agent, not a script):**

- **Memory:** source registry, page hashes, extracted facts with evidence quotes,
  per-source reputation and run history
- **Discovery:** expands to new sites/platforms via search, sitemaps, and
  link-following; proposes new sources instead of waiting for a list
- **Verification:** every fact must quote the official source; deadlines matched to
  source text; apply links tested; confidence thresholds gate publication
- **No fabrication:** the agent publishes no fact it did not read. Summarizing is
  allowed; inventing is not. Uncertainty is surfaced, never smoothed over
- **Suspicion and backoff:** sudden layout changes, implausible dates, domain
  mismatches, 403/429 responses → pause that source, retry with backoff, flag for
  review; repeatedly broken sources are retired rather than silently producing junk
- **Learning:** remembers which patterns/selectors worked per source and adapts;
  keeps a per-source history

**Steps per run:**

1. **Fetch** official pages (Playwright only where JS is required) and linked PDFs
2. **Hash** page content — skip unchanged pages to save AI quota
3. **Extract** structured fields + guide steps with AI, keeping evidence quotes
4. **Verify** per section 6; assign per-field status and confidence
5. **Dedupe** by canonical URL, then provider + normalized title; update cycles
6. **Publish** JSON data + static pages; commit; Cloudflare Pages rebuilds
7. **Report** the run: counts, failures, low-confidence items, stale sources

**Durable checkpoints and resume (quota exhaustion, crash, cancellation):**

- Every run writes a manifest: `runId`, `startedAt`, `status`
  (`running | paused | complete | failed`), provider cooldowns, and one item per
  queued source/page with its state
  (`pending | fetched | extracted | verified | published | failed | dead`).
- Item identity is stable (`programId`/source URL + content hash), so re-running
  a run skips completed items and never duplicates work or listings.
- State lives in `data/pipeline-state/` on a dedicated `pipeline-state` branch
  (or a single state commit) so the public site's data commit stays clean and
  reviewable. State is committed after each batch of items, not only at the end.
- When a provider returns 429/quota exhaustion, the router records a cooldown
  with an expiry, checkpoints the in-flight item back to `pending`, commits
  state, and exits with `status: paused`. The next scheduled run — or an admin
  "Resume" action — continues at the first non-complete item.
- Publishing is atomic per run: the site's data files are replaced in one
  commit only after verification. A paused run may publish the items already
  verified, with the run status recorded; it never publishes a half-written
  listing.
- No item is retried forever: each has an attempt counter and a dead-letter
  state, surfaced in the admin run report.
- The same rule applies to the build itself: plan checkboxes, the SDD progress
  ledger, and git commits are the durable record. After any quota limit or
  interruption, work resumes at the first unchecked task/commit — nothing is
  re-done and nothing is lost.

**Capacity target:** ~2,000 active listings, archive growing ~1,000/year. Index is
sharded by status/level; every listing gets its own static page; client-side
filtering stays instant.

**Free-tier budget and provider routing:**

- Only changed pages are re-extracted; target ≤ 200 AI calls/day
- Quota-aware router across providers; per-task fallback order; retries with
  exponential backoff and jitter; dead-letter after max attempts
- Every AI output is schema-validated with evidence quotes; two-model checks for
  deadline, apply URL, and eligibility claims
- On-site chat rate-limited per IP (e.g. 15 messages/day) to protect quota
- See section 9a for researched limits and task routing

## 9. Architecture — A (locked)

Static site + daily robot. No public server, no database, no public accounts.

| Part | Choice | Cost |
|---|---|---|
| Frontend | Astro (current stable) + TypeScript + Tailwind CSS | $0 |
| Data | JSON in the repo, zod-validated; one static page per listing | $0 |
| Refresh | GitHub Actions daily cron (public repo = free minutes) | $0 |
| Hosting | Cloudflare Pages (global CDN, free `*.pages.dev` subdomain) | $0 |
| AI assistant | Cloudflare Worker proxy → quota-aware provider router | $0 |
| Assistant state | Cloudflare KV: coarse per-IP limits + answer cache (no personal data) | $0 |
| Tracker | On-device localStorage, export/import backup | $0 |
| Scraping | TypeScript + Playwright (only for JS-heavy pages) + PDF parsing | $0 |
| Discovery | sitemaps/RSS first; Brave Search API free tier where available | $0 |
| Admin | Separate app behind Cloudflare Access; Worker API + GitHub token | $0 |
| Analytics (optional) | Cloudflare Web Analytics (privacy-friendly) | $0 |

**Why:** nothing to crash, no database, no personal data stored, unlimited traffic,
versioned data, fast on cheap phones, near-zero maintenance.

**Technology principles (modern, not dated):** static-first; TypeScript everywhere;
current stable versions pinned at build; Tailwind (no Bootstrap/jQuery/legacy CMS);
mobile-first responsive layout; dark/light mode; accessible (semantic HTML, keyboard,
contrast); no third-party trackers; no login walls.

**When the free AI quota runs out:** the assistant says it's busy and points to
browsing/filters — the site itself keeps working. Nothing else degrades.

## 9a. AI model & provider strategy (researched 2026-11-26/27)

Fetched from official docs; free tiers change, so the setup phase re-verifies them.

| Provider | Free allowance (official docs) | Use for | Notes |
|---|---|---|---|
| **Gemini API** | Free tier exists per Google Cloud project; exact limits shown in AI Studio; RPD resets midnight Pacific | PDF/HTML extraction, guide writing, chat fallback | Limits are **per project, not per API key** |
| **Groq** | `gpt-oss-120b`: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD | High-volume extraction, chat, research queries | Fast; limits are org-level |
| **OpenRouter** | Free models: 20 RPM; 50 RPD (<$10 credits ever) or 1,000 RPD (≥$10) | Chat fallback | Official docs: extra accounts/keys do **not** raise limits |
| **Cloudflare Workers AI** | 10,000 Neurons/day | Fallback extraction/chat, embeddings | Some frontier models require a paid plan |
| **GitHub Models** | **Retired 30 Jul 2026** | — | Do not use |
| **Brave Search API** | Free tier exists; quota not verified in this pass | Discovery queries | Sitemaps/RSS first; optional |

**Task routing (default; config-driven so models can be swapped):**

| Task | Primary | Fallback |
|---|---|---|
| Discovery query generation | Groq `gpt-oss-120b` | Gemini Flash |
| HTML extraction | Groq `gpt-oss-120b` | Gemini Flash |
| PDF extraction | Gemini Flash (long context, PDF) | Groq on extracted text chunks |
| Verification cross-check | the other provider (two-model check) | Cloudflare Workers AI |
| Guide writing | Gemini Flash | Groq `gpt-oss-120b` |
| On-site chat | Groq `gpt-oss-120b` | Gemini Flash → OpenRouter free |
| Embeddings (optional) | Cloudflare BGE | — |

**The 5 Gmail accounts:** quotas are per project/org, not per key. Multiple Google
projects (one per account) can be registered in the router as separate profiles,
but this must stay within each provider's terms — it is a resilience measure, not
a guarantee of multiplied quota. OpenRouter and Groq explicitly do not benefit
from extra accounts. Provider diversity is the primary strategy; multiple Gemini
projects are secondary.

**Harness (consistent, accurate results):**

- Versioned prompt files; JSON schema (zod) enforced; temperature 0
- Evidence quotes required for every extracted fact; outputs without evidence are
  rejected
- Two-model verification for deadline, apply URL, and eligibility claims
- Deterministic post-checks: date parsing against source text, URL HEAD + domain
  match, duplicate detection
- Golden fixtures + an eval script; CI runs the eval whenever a prompt changes
- Confidence thresholds; low confidence goes to the admin review queue, never
  straight to "verified"
- Checkpointing: every AI-assisted unit of work is resumable (see the durable
  checkpoints rules in section 8); a quota limit pauses, it never corrupts or
  loses work

**Retries and "never breaks" (honest):** no system never fails. The site is
decoupled and always serves the last good data. The pipeline isolates each source,
retries with exponential backoff and jitter, dead-letters after max attempts, and
alerts. A broken source or provider never takes the public site down.

## 9b. Admin site (separate, protected)

- **Separate deployment** (own route/subdomain) behind **Cloudflare Access** with
  email OTP for an allowlist of addresses; free plan historically includes up to
  50 users — verify at setup; fallback is GitHub OAuth with a username allowlist
- **Worker API** holds a fine-grained GitHub token (contents + actions write);
  secrets never touch the repo or the browser
- **No database:** the repo is the store; every action is a git commit and the
  audit log
- **Features:**
  - Review queue: new/changed listings, low-confidence items, evidence and source
    links side by side; approve, reject, edit
  - Run control: trigger a refresh, re-run failed items
  - Source health: last success, failures, stale/broken sources; pause or retire
  - Provider health: quota usage, cooldowns, errors
  - Run reports: counts, failures, dead links, low-confidence items
  - Listing corrections: fix a field, add evidence, re-verify
- **Safety:** validating edits with the same zod schema, preview before publish,
  and a revert path via git history

## 10. Pages and UX (public)

1. **Home** — hero with "I'm currently in: matric / intermediate / bachelor's /
   master's / PhD" selector; search; filters (level, country, funding, deadline
   window); sort (newest, best funded, deadline soonest); "eligible only" toggle;
   card grid with pagination
2. **Listing page** — guide, eligibility, documents, timeline, funding, big Apply
   button (only when verified), official sources + last verified, save to tracker,
   ask AI about this, report a problem, WhatsApp share
3. **Archive** — past/closed, same filters, clearly labelled
4. **My Applications** — saved listings, statuses, notes, countdowns, export/import
5. **How it works / About** — sourcing and verification explained, disclaimer,
   "never share personal details with the assistant"
6. **404 / offline-friendly fallback**

**UX principles:** phone-first; instant client-side filtering; skeleton states;
no dead ends (always a path to the official page); plain English; readable on 3G.

### Design research requirement (before any screen is built)

- Study current, high-quality education/product sites for layout, typography, and
  interaction patterns
- Choose a type scale and font pairing built for long reading on small screens;
  self-host fonts with system fallbacks
- Build a restrained color system with real contrast, spacing, and dark mode
- Explicitly **anti-template, anti-generic-AI-slop**: distinctive but calm
- Mobile-first, accessible, fast on mid-range phones and mobile data

## 11. My Applications (on-device)

- Save any listing; status: saved → applied → interview → offer / rejected
- Notes and deadline countdown
- Stored in localStorage, versioned schema; export/import backup code
- No emails or passwords stored; nothing leaves the device
- Accounts (sync, reminders) are a later phase if genuinely needed

## 12. AI assistant

- Answers grounded in listing data + official evidence quotes; always cites the
  listing/source and adds "confirm on the official page"
- Modes: "am I eligible?" (explains the conservative eligibility logic), "explain
  this listing", "what documents?", "what should I do next?"
- Refuses to invent deadlines or eligibility; says plainly when data is missing
- **Privacy:** eligibility is computed in the browser, not sent to any AI; the
  assistant never asks for names, emails, phone numbers, or documents; a notice
  says "don't share personal details"
- Rate-limited per IP; common answers cached in Cloudflare KV; friendly fallback
  when quota is exhausted
- Provider order: Groq → Gemini → OpenRouter free (config-driven)

## 13. Constraints

- $0 running cost; no surprise bills
- 24/7 availability; survives traffic spikes from public sharing
- Accuracy over coverage; show last-verified dates
- Simple enough for a non-technical owner to keep alive
- Scraping respects robots.txt and site terms; public pages only
- If the daily refresh fails, the site shows a freshness banner after ~36 hours;
  GitHub emails the owner on job failure
- Admin edits are schema-validated and audited as git commits
- No autonomous publishing of unverified facts

## 14. Decisions locked

| # | Decision |
|---|---|
| D1 | Scope: Pakistan (focus Sindh) → any country; all study levels |
| D2 | Data from automated daily scraping + AI, not manual posting |
| D3 | Level filter, eligible-only view, sort by recency / funding |
| D4 | Apply = direct link to the official application page |
| D5 | Free to run, 24/7 |
| D6 | This file is the single source of truth, edited in place |
| D7 | **Architecture A locked** — static site + daily robot, no public accounts |
| D8 | **Verified guides**: how/where to apply, documents, eligibility, timeline, funding, sourced from official pages |
| D9 | **On-device tracker** for applications; accounts deferred |
| D10 | Modern static stack (Astro, TypeScript, Tailwind, Cloudflare Pages, GitHub Actions) |
| D11 | Multiple intakes/cycles per scholarship; card shows the next deadline; program identity is separate from yearly cycles |
| D12 | Verification is per fact; an unverified deadline is never shown as a date |
| D13 | "Eligible" is conservative: level + Pakistani nationality + age; labelled "Likely eligible"; marks/English shown but not auto-checked |
| D14 | Source tiers: verified / provisional / unverified; bot-blocked and image-PDF official sources can be provisional with evidence |
| D15 | Capacity target ~2,000 active listings; archive grows; sharded index + static page per listing |
| D16 | Assistant limits/cache in Cloudflare KV; graceful fallback when quota is exhausted |
| D17 | Freshness banner after ~36h without a successful refresh; failure email to owner |
| D18 | Design research phase required before UI work; anti-template, mobile-first, self-hosted fonts |
| D19 | Scraper is an agent with memory, discovery, verification, suspicion/backoff, retirement, and learning |
| D20 | **Separate admin site**, Cloudflare Access-protected, GitHub-backed, no database; every action is a git commit |
| D21 | **Quota-aware provider router** (Gemini, Groq, Cloudflare Workers AI, OpenRouter); task-based routing; provider diversity first |
| D22 | **Harness**: versioned prompts, JSON schema, evidence quotes, two-model checks, golden evals; no autonomous publishing |
| D23 | Retries with backoff/jitter, dead-letter, per-source isolation, last-good data, alerts |
| D24 | Build split into five independently shippable plans (site → pipeline → admin → assistant → hardening) |
| D25 | Discovery prefers sitemaps/RSS; Brave Search optional; aggregators are discovery-only |
| D26 | **Resume everywhere**: build work and the daily pipeline checkpoint durable state after each unit and resume exactly where they stopped after a quota/API limit, crash, or cancellation; completed work is never repeated or lost |
| D27 | **Safe parallelism**: independent, non-conflicting work may run in parallel; implementation agents never share a working tree or edit the same files concurrently |

## 15. Open decisions

| # | Question | Current direction |
|---|---|---|
| Q1 | Notification channel (later) | Telegram or email, deferred |
| Q2 | Include local Pakistani scholarships? | Assumed yes |
| Q3 | Public vs link-only? | Assumed public |
| Q4 | UI language | English; Urdu toggle later |
| Q5 | Custom domain? | No — free `*.pages.dev` subdomain |

## 16. Left to the builder

- Exact source list and per-source parsers
- Prompt wording and golden fixtures
- Visual design details (within the researched, mobile-first principles)
- Account setup: GitHub, Cloudflare, Google AI Studio, Groq, Brave
- Test fixtures and data-quality checks

## 17. Build roadmap (five independently shippable plans)

| Plan | Delivers | Working software at the end |
|---|---|---|
| **1. Foundation & public site** | Schema, seed data, design system, home, listing, archive, tracker, deploy | A real static site anyone can browse and use |
| **2. Data pipeline & agent harness** | Fetchers, source plugins, extraction, verification, provider router, daily job, run reports | The site updates itself daily |
| **3. Admin site** | Access auth, Worker API, review queue, run control, source/provider health | The owner can review and control everything |
| **4. AI assistant** | Worker proxy, KV limits/cache, grounded chat UI, evals | Students can ask questions safely |
| **5. Hardening & launch** | E2E, accessibility, performance, monitoring, runbook, launch checklist | Production-ready, documented, monitored |

Each plan produces working, testable software on its own. Plan 1 is written now;
the next plan is written after Plan 1 is executed and verified.
