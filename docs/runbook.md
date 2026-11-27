# Deployment and operations runbook

This is a static site. There is no server, database, or runtime secret in the public
app: Cloudflare Pages serves the files produced by `npm run build` from `dist/`.

- **Hosting:** Cloudflare Pages, free plan
- **Source:** GitHub repository, production branch `main`
- **Build:** `npm run build`
- **Output:** `dist`
- **Node:** 24 (the version pinned in CI)
- **Data:** `src/data/programs/*.json`, validated by `src/lib/schema.ts` on every build
- **Data status:** `src/data/run-status.json` (`sample` or `live` + last successful run)

## One-time Cloudflare Pages setup (owner)

1. Push the repository to GitHub.
2. Open the Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Pages** → **Connect to Git**, then authorise GitHub and select this repository.
3. Use these build settings:
   - **Production branch:** `main`
   - **Framework preset:** Astro (or None)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION=24`
4. Save and deploy. **Expected:** the first production deployment succeeds and the
   build log ends with the page count and `sitemap-index.xml created`.
5. Open the `*.pages.dev` URL. **Expected:**
   - `/` returns 200 and shows the demo-data banner
   - a listing page, `/archive/`, `/about/`, and `/my-applications/` return 200
   - `/sitemap-index.xml` and `/robots.txt` return 200
   - the browser console has no errors
6. Optional custom domain: add it in **Custom domains**. Then replace the
   placeholder origin before the next deploy (see “Placeholders to replace”).

### Placeholders to replace at deploy

These are deliberately placeholders until the Cloudflare project name is fixed:

| File | Value |
| --- | --- |
| `astro.config.mjs` | `site: 'https://scholarship-tracker.pages.dev'` |
| `public/robots.txt` | `Sitemap: https://scholarship-tracker.pages.dev/sitemap-index.xml` |

Both must use the real production origin. The sitemap and canonical URLs depend on
them. The report-issue links already point at the project repository; if that
repository is private, make it public before launch or the links will return 404.

## Preview and production behaviour

- Every push to `main` creates a **production** deployment.
- Every other branch and every pull request creates a **preview** deployment with
  its own URL. Preview deployments are safe to share for review; they are not
  indexed unless linked.
- Cloudflare rebuilds automatically. There is no manual publish step.
- GitHub Actions runs the same checks on every push and PR: typecheck, unit tests,
  production build, and Playwright end-to-end tests.

## Rollback

1. Cloudflare dashboard → **Workers & Pages** → this project → **Deployments**.
2. Select the last known-good **production** deployment.
3. Choose **Rollback to this deployment** (Cloudflare may label it **Promote to
   production**).
4. **Expected:** the production alias switches to the older build immediately; no
   rebuild is needed.
5. Verify `/`, one listing page, `/archive/`, and `/sitemap-index.xml`.
6. Fix forward on `main`; do not delete deployments, because they are the rollback
   history.

If a bad **data** change was published, revert the commit that changed
`src/data/programs/` and push. Cloudflare rebuilds from the corrected data. Do not
hand-edit generated files in `dist/`.

## Manual verification checklist

Run these from a clean checkout:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run design:shots
```

Expected results:

- [ ] `npm run typecheck` — 0 errors, 0 warnings
- [ ] `npm test` — all unit tests pass
- [ ] `npm run build` — succeeds, writes `dist/`, creates `sitemap-index.xml`
- [ ] `npm run test:e2e` — all Playwright tests pass on the dedicated port 4322
- [ ] `npm run design:shots` — 12 screenshots at 360/768/1440 plus 1024 px overflow checks
- [ ] `npm run preview -- --port 4321` — `/` shows the demo-data banner and cards
- [ ] `/listing/chevening-pakistan/` — sources, last-verified dates, and Apply rules render
- [ ] `/archive/` — only closed cycles, `Closed` badge, no Apply buttons
- [ ] `/my-applications/` — empty state, then save/export/import/remove works
- [ ] `/about/` — sourcing, verification labels, privacy, and disclaimer are visible
- [ ] `/does-not-exist/` — returns 404 with links to the home page and archive
- [ ] `/sitemap-index.xml` and `/robots.txt` — 200 and the real origin
- [ ] 375 px wide — no horizontal scroll; axe reports no serious or critical issues
- [ ] Browser console — no errors

### Local check recorded on 2026-11-27

- `npm run typecheck`: 0 errors, 0 warnings
- `npm test`: 55 tests passed
- `npm run build`: 14 pages, sitemap created
- `npm run test:e2e`: 53 tests passed, including 16 design checks
- `npm run design:shots`: 12 screenshots at 360/768/1440 plus 1024 px overflow checks
- Local preview: home, listing, archive, about, My Applications, sitemap, and robots
  returned 200; an unknown path returned 404; the demo-data banner was visible
- Cloudflare deployment: **not performed here** — the owner completes the one-time
  setup above

## Freshness and the demo banner

`src/data/run-status.json` controls the site-wide banner:

```json
{ "mode": "sample", "lastSuccessfulRun": null }
```

- `sample` — the banner always says “Demo data — automated updates are not
  connected yet.” Keep this until the daily automation is actually running.
- `live` — the banner is hidden when `lastSuccessfulRun` is 36 hours old or newer;
  otherwise it says “Data last updated … — refresh may be delayed.”
- `lastSuccessfulRun` must be a real ISO timestamp written after a successful run.
  Never set it by hand to make the banner disappear.

The banner is dismissible per browser session and appears on every page.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Build fails with “Invalid program file” | The message names the JSON file; fix it against `src/lib/schema.ts`. |
| Sitemap or canonical URLs use the wrong domain | Update `site` in `astro.config.mjs` and the `Sitemap:` line in `public/robots.txt`. |
| “Report an issue” points at `OWNER/REPO` | Update `PUBLIC_REPO_URL` in `src/lib/constants.ts`. |
| e2e fails because port 4322 is busy | Stop the stale preview; the Playwright config always builds fresh and refuses to reuse a server. |
| Cloudflare build uses the wrong Node version | Set `NODE_VERSION=24` in the Pages environment variables. |
| Banner says demo data after automation is live | Confirm the robot committed `run-status.json` with `mode: "live"` and a fresh timestamp. |
