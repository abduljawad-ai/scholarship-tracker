# Design direction

Access date for all sources: **2026-11-27**. The sites below were read as patterns to learn from; no layout, copy, or branding was copied.

## Reference sites

### 1. GOV.UK Design System — https://design-system.service.gov.uk/ (public-service reference)

Also read: [page template](https://design-system.service.gov.uk/styles/page-template/) and [type scale](https://design-system.service.gov.uk/styles/type-scale/).

Patterns that work:

- **Skip link before the header, landing in a width-limited `<main>`.** The template puts `Skip to main content` ahead of `<header>`, and gives `<main id="main-content">` a single container. Why: keyboard users can bypass navigation in one keystroke, and reading width stays comfortable on large screens. Applied: `BaseLayout` emits the skip link first and `main#main` follows; the skip link becomes visible on focus.
- **Functional colour roles rather than raw hex values in components.** The colour guidance assigns `text`, `secondary-text`, `link`, `focus`, and background as named purposes, and explicitly requires WCAG 2.2 AA contrast. Why: a change to the palette does not require touching every component. Applied: all component styling reads semantic custom properties from `global.css`; no component contains a hex value.
- **A tested, responsive type scale with consistent vertical rhythm.** The scale increases body/heading sizes on small screens and uses line heights that are multiples of 5px. Why: legibility on phones without sacrificing scanning on desktop. Applied: a token-based type scale with explicit line heights, 16px body text (never smaller), and a fluid `clamp()` only for the hero heading.

Rejected: the GOV.UK brand blue, crown/logotype, and its fixed narrow typography — the site is independent and not a government service, and the warm neutral + emerald direction suits an education guide better.

### 2. MDN Web Docs — https://developer.mozilla.org/en-US/ (learning platform)

Also read: [frontend deep dive](https://developer.mozilla.org/en-US/blog/mdn-front-end-deep-dive/), April 8 2026.

Patterns that work:

- **Task-oriented top-level navigation and descriptive link labels.** The nav groups content by what a reader is trying to do (`HTML`, `CSS`, `Learn`, `Tools`, `About`) and sub-menus use plain language such as `Learn CSS: Styling basics`. Why: a large body of reference material stays navigable without a search-first mindset. Applied: a deliberately short four-destination header (`Scholarship Tracker`, `About`, `Archive`, `My Applications`) with descriptive, non-marketing labels; the nav can grow without restructuring.
- **Two explicit skip links (main content and search).** Why: different keyboard tasks need different bypass targets. Applied: the single main-content skip link required here; a second skip target would be added only if a persistent search control is introduced.
- **Simplified, unified styles and minimal shipped CSS/JS.** The 2026 frontend write-up describes replacing entangled styles with a flat, token-driven structure and shipping only the CSS/JS a page uses. Why: predictable styling and fast first render. Applied: one token file, semantic component classes, and a single tiny inline pre-paint script for theme selection — no theme framework or client-side router.

Rejected: MDN's very dense mega-menu and multi-column reference layout. This site has a handful of destinations, so that density would add noise, not wayfinding.

### 3. Stripe Docs — https://docs.stripe.com/ (polished product)

Also read: [Get started](https://docs.stripe.com/get-started).

Patterns that work:

- **Outcome-first entry points.** The landing content starts with `Create an account`, then `Start building`, then `Common use cases`, instead of an alphabetical product dump. Why: first-time visitors can identify their next action immediately. Applied: the home leads with a short, action-oriented statement and puts browsing first, with saved applications one click away in the header.
- **Short sections with plain, self-contained link text.** Each group is a small set of links whose text makes sense out of context. Why: scanning and screen-reader link lists both work. Applied: footer and nav links are explicit (`Report an issue or correction`, `My Applications`) rather than `click here`.
- **Restrained colour and generous whitespace around text-heavy content.** Why: hierarchy comes from spacing and size, not decoration. Applied: warm neutral surfaces, a single deep-emerald accent reserved for links, focus, and primary actions, and a spacing scale based on 4px increments.

Rejected: Stripe's gradients, illustration style, and product-marketing tone — they would compete with source-verification information, which is the substance of this site.

## Typography

Self-hosted variable fonts via Fontsource, imported in `src/styles/global.css` (no external font requests):

- Headings: **Source Serif 4 Variable**, fallbacks `Georgia`, `Cambria`, `"Times New Roman"`, `serif`. Weight 600 for headings; optical sizing on.
- Body: **Inter Variable**, fallbacks `system-ui`, `-apple-system`, `"Segoe UI"`, `Roboto`, `Helvetica`, `Arial`, `sans-serif`. Weight 400 body, 500–600 for UI labels.
- `font-display: swap` comes from Fontsource; preload is unnecessary because the CSS is bundled with the site.

Type scale (rem tokens; px shown at a 16px root). Line heights are unitless tokens so text stays proportional when users zoom:

| Token | Size | Line height | Use |
| --- | --- | --- | --- |
| `--type-xs` | 0.75rem / 12px | 1.5 | metadata |
| `--type-sm` | 0.875rem / 14px | 1.5 | footer, helper text |
| `--type-base` | 1rem / 16px | 1.625 | body |
| `--type-lg` | 1.125rem / 18px | 1.55 | lede |
| `--type-xl` | 1.25rem / 20px | 1.4 | section leads |
| `--type-2xl` | 1.5rem / 24px | 1.3 | h3 |
| `--type-3xl` | 2rem / 32px | 1.2 | h2 |
| `--type-4xl` | 2.5rem / 40px | 1.15 | h1 (mobile) |
| `--type-5xl` | 3rem / 48px | 1.1 | h1 (wide screens) |

## Spacing and radii

Spacing tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 40px, `--space-8` 48px, `--space-9` 64px, `--space-10` 80px, `--space-11` 96px, `--space-12` 128px. All in rem (base 0.25rem); Tailwind v4's `--spacing` is wired to `--space-1`, so utilities inherit the same scale.

Radius tokens: `--radius-small` 4px (controls), `--radius-medium` 8px (cards/inputs), `--radius-large` 14px (panels), `--radius-pill` 999px (status pills).

## Palette and measured contrast

Ratios were calculated from the sRGB hex values with the WCAG 2.x relative-luminance formula (linearised channels, `(L_lighter + 0.05) / (L_darker + 0.05)`). All text pairs below exceed WCAG AA (4.5:1 normal text; 3:1 large text and non-text focus indicators).

| Role | Token | Light hex | Dark hex |
| --- | --- | --- | --- |
| Page background | `--color-bg` | `#fbfaf7` | `#101714` |
| Raised surface | `--color-surface` | `#ffffff` | `#18221e` |
| Muted surface | `--color-surface-alt` | `#f3f1eb` | `#202c27` |
| Body text | `--color-text` | `#1c2723` | `#f2f4f0` |
| Muted text | `--color-text-muted` | `#4f5b55` | `#c3cdc6` |
| Accent (links, focus, marks) | `--color-accent` | `#0b5c3e` | `#7fd3ae` |
| Accent hover / active | `--color-accent-strong` | `#083d29` | `#a5e7c8` |
| Accent tint surface | `--color-accent-soft` | `#e6f0e9` | `#203b30` |
| Text on accent button | `--color-accent-contrast` | `#ffffff` | `#0d1a14` |
| Border | `--color-border` | `#d5d8d0` | `#3a4b42` |
| Control border | `--color-control-border` | `#7a857e` | `#6b8074` |
| Focus indicator | `--color-focus-ring` | `#0b5c3e` | `#7fd3ae` |

Measured ratios:

| Pair | Light | Dark |
| --- | --- | --- |
| Body text on page background | 14.75:1 (`#1c2723` / `#fbfaf7`) | 16.43:1 (`#f2f4f0` / `#101714`) |
| Muted text on page background | 6.80:1 (`#4f5b55` / `#fbfaf7`) | 11.14:1 (`#c3cdc6` / `#101714`) |
| Muted text on raised surface | 7.09:1 (`#4f5b55` / `#ffffff`) | 10.00:1 (`#c3cdc6` / `#18221e`) |
| Accent link on raised surface | 8.03:1 (`#0b5c3e` / `#ffffff`) | 9.20:1 (`#7fd3ae` / `#18221e`) |
| Accent link on accent tint | 6.89:1 (`#0b5c3e` / `#e6f0e9`) | 6.84:1 (`#7fd3ae` / `#203b30`) |
| Accent-button text on accent background | 8.03:1 (`#ffffff` / `#0b5c3e`) | 10.07:1 (`#0d1a14` / `#7fd3ae`) |
| Focus ring on page background | 7.69:1 (`#0b5c3e` / `#fbfaf7`) | 10.25:1 (`#7fd3ae` / `#101714`) |
| Control border on raised surface (non-text) | 3.83:1 (`#7a857e` / `#ffffff`) | 3.86:1 (`#6b8074` / `#18221e`) |
| Control border on page background (non-text) | 3.67:1 (`#7a857e` / `#fbfaf7`) | 4.30:1 (`#6b8074` / `#101714`) |

Status colours (added later with explicit icons/labels, never colour alone) will use accent tint for positive, warm amber `#8a4b08` on `#fff4e2` for caution, and `#9d2b25` on `#fdeceb` for negative; each pair is ≥ 4.5:1.

## Dark-mode mapping

- `:root` declares `color-scheme: light dark` and every token with CSS `light-dark(light, dark)`, so the browser resolves tokens from the system preference when no explicit theme is present — including when JavaScript is disabled.
- `[data-theme='light']` sets `color-scheme: light`; `[data-theme='dark']` sets `color-scheme: dark`. Because `light-dark()` resolves against `color-scheme`, one token declaration covers both modes and the table above is the complete mapping.
- An inline pre-paint script in `<head>` reads `localStorage.theme` and sets `data-theme` before first paint, preventing a flash of the wrong theme. Stored values are only `light` or `dark`; anything else falls back to `prefers-color-scheme`.
- A `change` listener on `prefers-color-scheme` follows live system changes **only while no explicit choice is stored**. The header toggle writes the choice to `localStorage` and updates `data-theme`; it also re-syncs the browser `theme-color` meta from the resolved root background (`--color-bg`), so no hex value is duplicated in markup.
