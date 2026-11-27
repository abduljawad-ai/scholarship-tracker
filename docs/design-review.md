# Design review rubric

Run this after every vertical slice. The reviewer never edits files; it files fixes for the build agent.

## How to run

1. `npm run design:shots`
   - Builds the site.
   - Starts a fresh preview on port 4322.
   - Saves full-page screenshots to `test-results/design-review/` at 360, 768, and 1440 px.
2. Read every screenshot.
3. Open `AGENTS.md` and `docs/design-brief.md`.
4. Score each axis 0–100. The total is the percentage of checks that pass.
5. Output the score table and ranked fixes. Every fix cites `file:line` and the exact change.
6. If the score is at least 90 and there are zero automatic fails, end with `SHIP`.

## Automatic fails

Any one of these means the slice cannot ship, regardless of score:

- Horizontal overflow at 360 px.
- Any standalone tap target (nav link, button, form control) under 44×44 px. Inline prose links are exempt.
- More than one primary button per viewport.
- Body text contrast under 4.5:1.
- A banned default from `AGENTS.md` section 3.
- An unverified or provisional deadline rendered as a date.
- An Apply button on a cycle that is not verified and open.
- A published fact with no official source or evidence quote.
- The demo banner is absent from a fresh session while `src/data/run-status.json` is `sample`.

## The 18 checks

### Purpose (3)

- [ ] The visitor's job is answerable in 3 seconds.
- [ ] Exactly one primary action per viewport.
- [ ] Proof sits next to the moment of doubt.

### Hierarchy (3)

- [ ] Display, text, and data faces are distinct.
- [ ] Scale contrast guides the scan path.
- [ ] The primary button is the only saturated one.

### Psychology (3)

- [ ] At most 5 top-level nav choices; decisions chunk at most 7.
- [ ] Feedback under 100ms; progress under 400ms.
- [ ] The success or confirmation screen got the peak-end polish.

### Responsive (3)

- [ ] 360 px: zero overflow, thumb-reach primary action.
- [ ] 768 px: layout re-composed, not squeezed.
- [ ] 1440 px: measure capped, no dead center.

### States (3)

- [ ] Hover, focus-visible, active, disabled.
- [ ] Loading, empty, error, success.
- [ ] Reduced motion honored; scrollbars styled.

### Access and contrast (3)

- [ ] Body text at least 4.5:1; UI at least 3:1.
- [ ] Full keyboard path, logical tab order.
- [ ] Meaning never rides on color alone.

## Score

`score = passed checks / 18 * 100`

| Score | Verdict |
| --- | --- |
| 0 | UNREVIEWED |
| 1–39 | SLOP ZONE |
| 40–74 | COMPETENT |
| 75–89 | ALMOST THERE |
| 90–100 | PORTFOLIO-GRADE |

Ship only at 90–100 with zero automatic fails.

## Output format

```text
## Score
Purpose 3/3 · Hierarchy 2/3 · Psychology 3/3 · Responsive 3/3 · States 2/3 · Access 3/3 = 89/100 — ALMOST THERE

## Automatic fails
- none

## Ranked fixes
1. src/components/FilterBar.astro:41 — label is 3.9:1 on the surface; use --color-text-muted (6.8:1).
2. src/pages/listing/[slug].astro:230 — the Apply button and the Save button are both saturated; make Save quiet.
3. src/styles/global.css:210 — the card hover shift is not disabled under reduced motion.
```

Vague feedback ("make it modern", "add polish") is forbidden.
