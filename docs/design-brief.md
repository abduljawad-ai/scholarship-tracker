# Design brief — Scholarship Tracker

Last updated: 2026-11-27
Owner: design-lead
Status: approved for the public site

## 1. Job

A Pakistani student needs to find a scholarship they can actually apply for, understand the real requirements, and keep track of the deadline without an account.

The site is not a news feed and not an aggregator. It is a short, verified guide to each opportunity.

## 2. Audience

- Pakistani students, mostly Sindh, aged 16–25.
- Many are first-generation applicants. They may not know what a transcript, an attestation, or a statement of purpose is.
- They arrive on a cheap Android phone, often on mobile data, sometimes on a slow connection.
- They are cautious. They have seen fake scholarship pages and paid "agents".
- They compare a few options quickly, then commit to one.

## 3. One action per page

| Page | Primary action | Secondary actions |
| --- | --- | --- |
| Home | Find scholarships: use search and filters | Open a guide |
| Listing | Apply on the official portal (only when the cycle is verified and open) | Save to My Applications, visit the official page |
| Archive | Browse open scholarships (go home) | Open a closed guide |
| My Applications | Browse scholarships when empty; export the backup when there are saved items | Change status, add a note, remove |
| About | Browse scholarships | Report an issue |
| 404 | Go home | Browse the archive |

Only one saturated primary button per viewport. The Apply button is the only saturated action on a listing. When Apply is not safe, the page explains why instead of showing a dead button.

## 4. Proof at the moment of doubt

- Every listing links to the official page.
- Every published fact has an evidence quote from an official page or PDF.
- Each cycle shows a last-verified date and a label: verified, provisional, or unverified.
- An unverified deadline is never shown as a date. It says "not confirmed".
- Eligibility says "Likely eligible", never "You qualify".
- The demo banner is visible until a real automation run succeeds.
- No login, no tracking, and no server copy of the student's applications.

## 5. Tone

Calm, plain-spoken, and specific. Short sentences. No hype. No "unlock your future". No exclamation marks. Explain a term the first time it appears. The student should feel informed, not sold to.

## 6. The three things this site must never look like

1. A generic purple-on-white SaaS landing page with three identical feature cards.
2. A government portal with dense forms, jargon, and no clear next step.
3. A scholarship spam site with ads, pop-ups, fake urgency, and no sources.

## 7. Art direction

- Warm paper neutrals and a deep emerald accent. The subject is guidance and trust, not finance or entertainment.
- One saturated accent for the primary action. Everything else is neutral.
- Serif headings for a calm, editorial feel; sans-serif body for fast reading; no third display face.
- Generous space around text. Borders are a last resort; proximity groups first.
- Light and dark modes use the same semantic tokens.

## 8. Palette

Use the tokens in `src/styles/global.css`. Do not add raw hex values to components.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#fbfaf7` | `#101714` |
| Surface | `#ffffff` | `#18221e` |
| Text | `#1c2723` | `#f2f4f0` |
| Muted text | `#4f5b55` | `#c3cdc6` |
| Accent | `#0b5c3e` | `#7fd3ae` |
| Accent contrast | `#ffffff` | `#0d1a14` |
| Border | `#d5d8d0` | `#3a4b42` |

All documented pairs are at least 4.5:1. See `docs/design-direction.md` for the measured table.

## 9. Type and space

- Headings: Source Serif 4 Variable, weight 600.
- Body: Inter Variable, weight 400; 500–600 for labels.
- Body text is 16px minimum. Measure 45–75ch. Body leading 1.625.
- Type scale: `--type-xs` 12px to `--type-5xl` 48px. Fluid `clamp()` only for the hero heading.
- Spacing: 4px base (`--space-1` to `--space-12`). Radius: 4px controls, 8px cards, 14px panels.
- Hierarchy comes from contrast of scale, weight, and space, not from making everything bigger.

## 10. Motion

Minimal. Fades and small shifts only. No parallax, no bouncing cards, no autoplay. Every transition is disabled under `prefers-reduced-motion: reduce`. Feedback appears under 100ms; anything slower shows progress.

## 11. Token sheet

These are the names to use. The values live in `src/styles/global.css`.

```css
--color-bg; --color-surface; --color-surface-alt;
--color-text; --color-text-muted;
--color-accent; --color-accent-strong; --color-accent-soft; --color-accent-contrast;
--color-border; --color-focus-ring;
--font-body; --font-heading;
--type-xs; --type-sm; --type-base; --type-lg; --type-xl; --type-2xl; --type-3xl; --type-4xl; --type-5xl;
--space-1; --space-2; --space-3; --space-4; --space-5; --space-6;
--radius-small; --radius-medium; --radius-large; --radius-pill;
```

## 12. Definition of done

- [ ] The four brief answers are visible in the layout.
- [ ] One primary action is isolated and unmissable.
- [ ] The palette and type come from the subject; no banned defaults.
- [ ] 360, 768, 1024, and 1440 px are clean; no horizontal overflow.
- [ ] Standalone touch targets are at least 44×44 px. Inline prose links are exempt.
- [ ] All states exist: hover, focus-visible, active, disabled, loading, empty, error, success.
- [ ] Body contrast is at least 4.5:1; meaning never rides on color alone.
- [ ] `prefers-reduced-motion` is honored.
- [ ] The trust rules in `AGENTS.md` hold.
- [ ] The rubric score is at least 90 with zero automatic fails.
