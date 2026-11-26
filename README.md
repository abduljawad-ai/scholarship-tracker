# Scholarship Tracker

A static scholarship listing site built with [Astro](https://astro.build), Tailwind CSS v4, and TypeScript (strict).

## Requirements

- Node.js (current LTS)

## Scripts

| Script              | Purpose                          |
| ------------------- | -------------------------------- |
| `npm run dev`       | Start the dev server             |
| `npm run build`     | Build the static site to `dist/` |
| `npm run preview`   | Preview the production build     |
| `npm test`          | Run unit tests (Vitest)          |
| `npm run test:e2e`  | Run end-to-end tests (Playwright) |
| `npm run typecheck` | Type-check with `astro check`    |

## CI

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
