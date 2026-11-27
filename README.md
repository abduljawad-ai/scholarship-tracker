# Scholarship Tracker

Free, independent scholarship guidance for Pakistani students, focused on Sindh.
Every listing is a step-by-step guide built from official pages and documents, with
the evidence quote and the date it was last checked. There are no accounts, and the
application tracker stays in your browser.

**Current status: Plan 1 — public site foundation.** The listings shown are a small
seed set and the site is in **demo mode** (`src/data/run-status.json`), so the
site-wide banner says automated updates are not connected yet. The daily scraper,
admin console, and AI assistant arrive in later plans. Do not switch the banner to
`live` until the automation is actually running.

## Stack

- [Astro](https://astro.build) 7, static output
- Tailwind CSS v4 plus a token-based custom design system
- TypeScript strict, Zod schemas for listing data
- Vitest for unit tests, Playwright + axe-core for browser and accessibility tests
- Cloudflare Pages (free plan) for hosting

## Requirements

- Node.js 24 (the version used by CI and Cloudflare Pages)

## Quick start

```bash
npm ci
npm run dev        # http://localhost:4321
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the static site to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check Astro and TypeScript files |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Build fresh and run Playwright tests on port 4322 |

## Pages

- **Home** — search, study-level/country/funding filters, deadline window,
  “likely eligible” toggle, sorting, pagination, and server-rendered cards that work
  without JavaScript
- **Listing** — eligibility, documents, timeline, funding, how and where to apply,
  official sources with last-verified dates, evidence quotes, save to My
  Applications, share, and report a problem
- **Archive** — closed cycles kept for reference, clearly labelled, with no Apply
  buttons
- **My Applications** — on-device statuses, notes, deadline countdowns, and
  export/import backup
- **About** — how sourcing, verification labels, privacy, and independence work
- **404** — a useful page with links back to current and archived scholarships

## Data and trust model

Listings live in `src/data/programs/*.json` and are validated against
`src/lib/schema.ts` on every build. Each program has stable `programId` values and
one or more cycles, so a saved application survives when a new cycle opens.

- **Verified** — read on an official page or document, with a stored evidence quote
- **Provisional** — an official source exists but could not be fully checked (for
  example, a bot-blocked page, an image PDF, or a Facebook post)
- **Unverified** — not confirmed; an unverified deadline is never shown as a date
  and an Apply button appears only for a verified, open cycle

“Likely eligible” is a conservative guide based on study levels, never a provider’s
decision. News articles and aggregators are discovery leads only, never facts.

`src/data/run-status.json` drives the freshness banner: `sample` always shows the
demo notice; `live` shows a warning when the last successful run is missing or older
than 36 hours.

## Testing

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The e2e suite covers the home filters, listing trust rules, archive, tracker
persistence, metadata/sitemap, the demo banner, axe accessibility checks, and
375 px overflow. Unit tests cover schema validation, selectors, eligibility,
filters, formatting, the tracker, freshness, and the 2,000-listing index budget.

## Deploy

The site is designed for Cloudflare Pages on the free plan:

- Build command: `npm run build`
- Output directory: `dist`
- Node: 24
- Production branch: `main`

Every push to `main` becomes a production deployment; other branches and pull
requests get preview URLs. Rollback is a previous-deployment promotion in the
Cloudflare dashboard.

See **[docs/runbook.md](docs/runbook.md)** for the full checklist, rollback steps,
placeholder values to replace, and troubleshooting. In particular, replace the
placeholder origin in `astro.config.mjs` and `public/robots.txt` before launch. The
report-issue links already point at the project repository; make that repository
public before launch if you want visitors to be able to file issues.

## Documentation

- [Design blueprint](docs/superpowers/specs/2026-11-26-scholarship-tracker-design.md)
- [Plan 1 — public site foundation](docs/superpowers/plans/2026-11-27-foundation-public-site.md)
- [Design direction](docs/design-direction.md)
- [Deployment runbook](docs/runbook.md)
