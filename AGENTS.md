# AGENTS.md — project rules

## 0. Prime directive

This is a free scholarship tracker for Pakistani students, focused on Sindh.
The site must be trustworthy, fast on cheap phones, and usable without an account.
No fact is published without an official source. No UI is written without a brief.

## 1. Trust rules (non-negotiable)

- Every published fact needs a quote from an official page or PDF. Aggregators are discovery only.
- Label each fact `verified`, `provisional`, or `unverified`.
- Never render an unverified or provisional deadline as a date. Show "not confirmed".
- Show Apply only for a verified, open or upcoming cycle with a real apply URL.
- Eligibility is conservative: match `applicantStages` only. Say "Likely eligible", never "You qualify".
- Keep `src/data/run-status.json` at `sample` until a real automation run succeeds.
- Never commit API keys, tokens, or personal data.

## 2. Brief gate

Before any UI work, read `docs/design-brief.md`.
If it does not answer JOB, AUDIENCE, ONE ACTION, and PROOF for the screen, stop and run `/brief`.
Never invent a generic hero or a row of three identical cards.

## 3. Art direction

- Derive the palette from the subject, not from defaults.
- Use the tokens in `src/styles/global.css`. Do not put raw hex values in components.
- Keep the warm neutral + deep emerald direction. One saturated accent for the primary action.
- Banned unless the brief demands them: purple-on-white gradients, Inter-only typography,
  emoji as icons, three identical feature cards, a centered hero plus card row, gray-on-gray
  text, and uniform spacing with no hierarchy.
- Every section earns its own composition. Repetition is a smell.

## 4. Type and space

- Headings: Source Serif 4 Variable. Body: Inter Variable. No new font without a reason.
- Use the existing type scale (`--type-xs` to `--type-5xl`). Body text is 16px minimum.
- Measure 45–75ch. Body leading 1.5–1.7.
- Use the 4px spacing scale (`--space-1` to `--space-12`).
- Hierarchy comes from contrast of scale, weight, and space, not from making everything bigger.

## 5. Psychology (non-negotiable)

- Von Restorff: exactly one primary action per viewport; it gets the only saturated button.
- Hick: at most 5 top-level nav choices; at most 7 options per decision group.
- Fitts: standalone touch targets (nav links, buttons, form controls) at least 44×44px with at least 8px separation; primary actions in thumb reach. Inline links inside prose are exempt.
- Doherty: feedback under 100ms; complete or show progress under 400ms; never a dead click.
- Gestalt: group by proximity first, borders last. Labels sit next to their fields.
- Jakob: familiar patterns for forms, nav, and filters. Novelty in art direction, not mechanics.
- Peak-end: the confirmation or success screen gets the most polish.

## 6. Responsive contract

- Mobile-first. Verify at 360×800, 768×1024, 1024×768, and 1440×900.
- No horizontal overflow anywhere. No fixed px widths on containers.
- Nav collapses to a working menu. Tables become cards or scroll with a visible affordance.
- Reading works without JavaScript. Filters and the tracker may enhance the page.

## 7. States and accessibility

- Every interactive element: hover, focus-visible, active, disabled, loading, empty, error, success.
- WCAG AA: 4.5:1 body text, 3:1 large text and UI borders. Never color-only meaning.
- Semantic landmarks, logical tab order, alt text, and `prefers-reduced-motion` honored.
- Style scrollbars in the site palette. Never leave the browser default.
- Keep the skip link, visible focus rings, and the demo/freshness banner.

## 8. Self-review loop (mandatory)

After each vertical slice:

1. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
2. Run `npm run design:shots` to capture 360/768/1440 screenshots.
3. Score the slice against `docs/design-review.md`. Fix the top 3 issues before moving on.

Never present unreviewed UI as done. First drafts are never done.

## 9. Definition of done

- [ ] The four brief answers are visible in the layout.
- [ ] One primary action, isolated and unmissable.
- [ ] Palette and type derived from the subject; zero banned defaults.
- [ ] All four viewports clean; standalone targets at least 44×44px.
- [ ] All states implemented; AA contrast verified.
- [ ] Screenshots attached; rubric at least 90 with zero automatic fails.
- [ ] Trust rules hold: every fact has a source; unverified deadlines are not dates.

## 10. Data rules

- `src/data/` is the published data. Keep `programId` stable.
- Keep every cycle. Add new cycles; never overwrite history.
- Closed cycles stay in the archive with no Apply button.
- The tracker stores `programId` + `cycleId`; do not break saved entries.
- Do not hand-edit generated data. The Plan 2 robot owns it.

## 11. Commands

- `npm run dev` — local dev server on http://localhost:4321
- `npm run build` — static build to `dist/`
- `npm run preview` — preview the build
- `npm run typecheck` — Astro and TypeScript checks
- `npm test` — unit tests
- `npm run eval` — replay the golden fixtures through the real pipeline code
- `npm run pipeline -- --dry-run` — pipeline dry run; no AI keys, no writes
- `npm run test:e2e` — Playwright tests on a fresh build
- `npm run design:shots` — 360/768/1440 screenshots to `test-results/design-review/`

## 12. Agent workflow

- Implementation is done by the primary agent. Do not spawn subagents for coding.
- The `design-review` subagent is read-only. It may run the site and take screenshots,
  but it must not edit files.
- The `design-lead` agent writes the brief and tokens only. It does not write UI code.
