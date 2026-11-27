# Plan 1.5 — Design Completion

> **For agentic workers:** This plan is executed natively by the primary agent.
> The user approved the work and `AGENTS.md` forbids coding subagents. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every public screen against the approved design brief so the
site reads as a verified scholarship register, not a generic hero-and-card
template.

**Architecture:** Keep the static Astro site, the data model, the client
filters, and the local-storage tracker. Replace the visual layer: a
register/ledger composition, a verification-stamp system, deadline slips, a
two-column listing dossier, a closed archive ledger, and a device-file tracker.
No new runtime dependencies, no webfonts, no images.

**Tech Stack:** Astro 7, TypeScript, vanilla CSS with the existing tokens,
client scripts already in `src/scripts/`.

**Spec:** `docs/design-brief.md`, `AGENTS.md`, `docs/design-review.md`.

## Design read

Reading this as: a trust-first public-service register for Pakistani students,
with an editorial document language, leaning toward a paper register with
stamps, deadline slips, and source clippings.

- **Variance 5 / Motion 2 / Density 5.** Asymmetry comes from the masthead and
  dossier, not from decoration. Motion is limited to state feedback.
- **Palette and type are fixed by the brief.** Warm paper, white surface, deep
  emerald accent, Source Serif 4 headings, Inter body. Add a system monospace
  stack for dates, stamps, counts, and source labels. No new webfont.
- **Signature:** the verification stamp and the deadline slip. They encode the
  trust model instead of decorating it. A verified deadline gets a solid slip
  with a real date; an unverified one gets a dashed slip with no date.
- **No photography.** The subject's artifacts are official notices, dates, and
  source quotes. Real text clippings are the visual material; stock photos
  would add weight and reduce trust.
- **One primary action per viewport.** Home: the search field. Listing: Apply
  (only when verified and open). Archive: browse current scholarships. Tracker:
  browse when empty, export when populated. About: browse. 404: browse.

## Global constraints

- Use only the tokens in `src/styles/global.css`. No raw hex in components.
- Body text 16px minimum; measure 45–75ch; leading 1.5–1.7.
- Standalone targets at least 44×44px; inline prose links are exempt.
- Every page must work at 360, 768, 1024, and 1440px with no horizontal overflow.
- Reading works without JavaScript. Filters and the tracker may enhance.
- Unverified or provisional deadlines are never rendered as dates.
- Apply only for a verified, open or upcoming cycle with a real URL.
- Keep the demo/freshness banner, skip link, focus rings, and semantic landmarks.
- Keep every `data-testid` and accessible label used by the existing e2e suite.
- Respect `prefers-reduced-motion`; style scrollbars in the site palette.
- Run `typecheck`, unit, build, e2e, and `design:shots` after each slice.

## Review focus

- A long program title must wrap inside the register row without horizontal
  overflow at 360px.
- A listing with two cycles must keep one visible panel and two share links,
  and must show every cycle when JavaScript is unavailable.
- A saved tracker entry whose program is missing from the index must still
  render without throwing.
- The deadline desk must never show an unverified date, and must render a
  useful empty state when no verified deadline exists.
- The tracker export button must not be a saturated primary action while the
  file is empty, and must become the primary action once an entry exists.

---

### Task 1: Design primitives and tokens

**Files:**
- Modify: `src/styles/global.css`
- Test: `tests/e2e/design-review.spec.ts`

**Interfaces:**
- Produces: `.stamp`, `.stamp--verified`, `.stamp--check`, `.stamp--closed`,
  `.slip`, `.slip--unconfirmed`, `.slip--closed`, `.mono-label`,
  `--font-mono`, `.button--primary`, `.button--quiet`.
- Keeps: `.container`, `.sr-only`, `[hidden]`, `.skip-link`, focus-visible.

- [ ] Add `--font-mono` and the stamp/slip primitives.
- [ ] Keep every existing token name; do not rename tokens.
- [ ] Add an e2e guard: at most one visible `.button--primary` per route.
- [ ] Run `npm run typecheck` and `npm test`.

### Task 2: Header, footer, and data-status strip

**Files:**
- Modify: `src/components/Header.astro`, `src/components/Footer.astro`,
  `src/components/FreshnessBanner.astro`, `src/styles/global.css`

- [ ] Keep the brand, three nav links, theme toggle, and 44px targets.
- [ ] Make the freshness banner a slim status strip, not a green card.
- [ ] Keep the demo text and dismiss behaviour.
- [ ] Verify the skip link and theme toggle still work.

### Task 3: Home — masthead, deadline desk, register

**Files:**
- Modify: `src/pages/index.astro`, `src/components/FilterBar.astro`,
  `src/components/ListingCard.astro`, `src/components/EmptyState.astro`,
  `src/components/Pagination.astro`, `src/scripts/home.ts`,
  `src/styles/global.css`
- Test: `tests/e2e/home.spec.ts`, `tests/e2e/design-review.spec.ts`

**Interfaces:**
- Consumes: `loadPrograms`, `nextCycle`, `toIndexEntry`, `sortIndex`.
- Produces: a build-time `deadlineDesk` of at most three verified deadlines;
  a register row with `data-testid="listing-card"`, `data-program-id`, and
  `data-testid="card-${programId}"`.

- [ ] Replace the centered hero with a left masthead and a deadline desk.
- [ ] Make the deadline desk show only verified dates; add an honest empty state.
- [ ] Turn the filter card into a search band; keep all labels and 44px controls.
- [ ] Replace the three-column card grid with a hairline register.
- [ ] Add a proof section with one real evidence quote and the three labels.
- [ ] Bind every `[data-testid="clear-filters"]` in `home.ts`.
- [ ] Add a `<noscript>` note that the full register is listed below.
- [ ] Verify the home e2e tests and no overflow at 360px.

### Task 4: Listing — dossier and status rail

**Files:**
- Modify: `src/pages/listing/[slug].astro`, `src/components/GuideSection.astro`,
  `src/components/TrackerControls.astro`, `src/components/VerificationBadge.astro`,
  `src/components/FundingBadge.astro`, `src/components/EligibilityNote.astro`,
  `src/scripts/listing.ts`, `src/styles/global.css`
- Test: `tests/e2e/listing.spec.ts`

- [ ] Put the status rail first in the DOM; grid it to the right on desktop and
  above the guide on mobile.
- [ ] Keep Apply as the only saturated button; make Save quiet.
- [ ] Keep the Apply link's accessible name starting with "Apply".
- [ ] Redesign steps, documents, timeline, funding, eligibility, sources, and
  evidence as hairline sections, not cards.
- [ ] Render every cycle panel without `hidden`; let the script hide the
  non-default panels on init. This keeps all cycles readable without JS.
- [ ] Keep two share links for a two-cycle program.
- [ ] Verify listing e2e tests and the no-Apply case.

### Task 5: Archive — closed register

**Files:**
- Modify: `src/pages/archive.astro`, `src/components/ListingCard.astro`,
  `src/components/FilterBar.astro`, `src/styles/global.css`
- Test: `tests/e2e/archive.spec.ts`

- [ ] Add an archive intro with the primary "Browse current scholarships" action.
- [ ] Move the filter into a compact sidebar on desktop.
- [ ] Render archive rows with a Closed stamp, "Applications closed", and the
  official-page link; no deadline date and no Apply.
- [ ] Keep `card-commonwealth-pakistan-2025`, the exact "Closed" text, and the
  official link label.
- [ ] Verify archive e2e tests.

### Task 6: My Applications — device file

**Files:**
- Modify: `src/pages/my-applications.astro`, `src/scripts/tracker-page.ts`,
  `src/styles/global.css`
- Test: `tests/e2e/tracker.spec.ts`

- [ ] Add a device-file header with a privacy slip.
- [ ] Style saved entries as ledger rows with a deadline slip.
- [ ] Keep the empty state's "Browse scholarships" as the only primary action.
- [ ] Make export quiet and disabled while empty; make it primary and enabled
  when an entry exists.
- [ ] Keep the import fields visible for the existing tests.
- [ ] Verify tracker e2e tests.

### Task 7: About and 404 — method and missing notice

**Files:**
- Modify: `src/pages/about.astro`, `src/pages/404.astro`,
  `src/styles/global.css`
- Test: `tests/e2e/meta.spec.ts`

- [ ] Turn About into a numbered method page with a source specimen.
- [ ] Keep the "official sources" text and the report link.
- [ ] End About with one primary "Browse scholarships" action.
- [ ] Turn 404 into a stamped missing notice; keep the "Page not found" heading
  and the "Browse scholarships" link.
- [ ] Verify meta and 404 tests.

### Task 8: Responsive, dark mode, states, and accessibility

**Files:**
- Modify: `src/styles/global.css`, `src/components/*.astro`,
  `src/pages/*.astro` as needed
- Test: `tests/e2e/a11y.spec.ts`, `tests/e2e/layout.spec.ts`,
  `tests/e2e/design-review.spec.ts`

- [ ] Check 360/768/1024/1440 for overflow and composition.
- [ ] Check light and dark modes on every screen.
- [ ] Check hover, focus-visible, active, disabled, loading/empty/error/success.
- [ ] Check 44px targets on nav, buttons, inputs, selects, and row links.
- [ ] Style scrollbars in the palette; honour reduced motion.
- [ ] Run axe on home, listing, archive, and tracker.

### Task 9: Design review and ship

**Files:**
- Modify: any file the rubric flags.
- Test: `tests/e2e/design-review.spec.ts`, `docs/design-review.md`.

- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- [ ] Run `npm run design:shots`; read all 12 screenshots.
- [ ] Score the 18 checks. Fix the top three. Repeat until ≥90 with zero
  automatic fails.
- [ ] Commit the redesign and push the branch.
- [ ] Open a PR, wait for CI, merge to `main`, and confirm the live site.
