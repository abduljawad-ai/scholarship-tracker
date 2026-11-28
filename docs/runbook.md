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

### Production origin

The production URL is:

```text
https://scholarships-pk.pages.dev
```

| File | Value |
| --- | --- |
| `astro.config.mjs` | `site: 'https://scholarships-pk.pages.dev'` |
| `public/robots.txt` | `Sitemap: https://scholarships-pk.pages.dev/sitemap-index.xml` |

Both must use the stable production alias. Never use a per-deployment hash URL
(such as `e4930463.scholarships-pk.pages.dev`): the hash changes on every
deploy, so canonical links and the sitemap would point at an old frozen build.
The sitemap and canonical URLs depend on this value. The report-issue links
point at the project repository. Keep that repository public before launch, or
the links will return 404 for visitors who are not signed in to GitHub.

The previous project, `scholarship-tracker` (hostname
`scholarship-tracker-6wv.pages.dev`), still exists and builds from the same
repository. It is a temporary backup. Delete it in **Workers & Pages** when the
new project has been stable for a few days, so each push stops triggering two
builds.

### Reconnect Git when Cloudflare says the project is disconnected

If the Pages project shows **“This project is disconnected from your Git
account. This may cause deployments to fail.”**, pushes to `main` will not
deploy. Cloudflare's documented fix is to check repository access first, then
reinstall the GitHub app if access is already granted.

The GitHub app is named **Cloudflare Workers and Pages**. It is shared by
Workers and Pages projects. Uninstalling it affects every project connected to
that GitHub account, so do that only if the access check does not fix it.

1. Open the Cloudflare dashboard → **Workers & Pages** → the project.
2. Go to **Settings** → **Builds** → **Git Repository** → **Manage**.
3. On GitHub, open the **Cloudflare Workers and Pages** app settings.
   Under **Repository access**, confirm that **Only select repositories**
   includes `abduljawad-ai/scholarship-tracker`. If it is missing, add it and
   save. Then retry a deployment.
4. If access is already granted, reinstall the app:
   - In the GitHub app settings, choose **Uninstall "Cloudflare Workers and
     Pages"** → **Uninstall**.
   - Return to Cloudflare → **Workers & Pages** → **Create application** →
     **Pages** → **Connect to Git**.
   - Choose **+ Add account**, select the GitHub account, then **Install &
     Authorize**. Grant access to `scholarship-tracker`.
5. Return to the existing project (do not create a duplicate) and use
   **Retry deployment** on the latest production build, or push an empty commit
   to `main`.
6. **Expected:** the warning disappears and a new production deployment builds
   from the latest `main` commit with branch `main`, command `npm run build`,
   output `dist`, and `NODE_VERSION=24`.

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
npm run eval
npm run build
npm run test:e2e
npm run design:shots
```

Expected results:

- [ ] `npm run typecheck` — 0 errors, 0 warnings
- [ ] `npm test` — all unit tests pass
- [ ] `npm run eval` — 4 golden fixtures pass
- [ ] `npm run build` — succeeds, writes `dist/`, creates `sitemap-index.xml`
- [ ] `npm run test:e2e` — all Playwright tests pass on the dedicated port 4322
- [ ] `npm run design:shots` — 27 screenshots at 360/768/1440, 1024 px overflow checks, and dark mode
- [ ] `npm run preview -- --port 4321` — `/` shows the demo-data banner and cards
- [ ] `/listing/chevening-pakistan/` — sources, last-verified dates, and Apply rules render
- [ ] `/archive/` — only closed cycles, `Closed` badge, no Apply buttons
- [ ] `/my-applications/` — empty state, then save/export/import/remove works
- [ ] `/about/` — sourcing, verification labels, privacy, and disclaimer are visible
- [ ] `/does-not-exist/` — returns 404 with links to the home page and archive
- [ ] `/sitemap-index.xml` and `/robots.txt` — 200 and the real origin
- [ ] 375 px wide — no horizontal scroll; axe reports no serious or critical issues
- [ ] Browser console — no errors

### Local check recorded on 2026-11-28

- `npm run typecheck`: 0 errors, 0 warnings (99 files)
- `npm test`: 26 files, 230 tests passed
- `npm run eval`: 4 golden fixtures passed
- `npm run build`: 14 pages, sitemap created
- `npm run test:e2e`: 85 passed, 1 skipped (the banner test skips when data is fresh)
- `npm run design:shots`: 45 checks — screenshots at 360/768/1440, 1024 px overflow,
  dark mode, and a 44 px minimum on every standalone target
- Local preview: home, listing, archive, about, My Applications, sitemap, and robots
  returned 200; an unknown path returned 404
- Cloudflare deployment: **live** at `https://scholarships-pk.pages.dev`

### First live run recorded on 2026-11-28

The first scheduled run (`46123512632`) paused after three sources: Groq answered
429 with a nine-second token-per-minute limit and no `Retry-After` header. The
router cooled the only provider down for fifteen minutes, so the run stopped.
The retry fix (`#8`) reads the wait from the provider message, retries short
waits in place, and checks monitor sources before any AI work.

The resumed run (`46124152331`) completed in 2m52s and committed `aa73a84`:

- Checked 6, published 4 (`daad-epos`, `sindh-endowment-fund`,
  `sindh-matric-scholarship`, `turkiye-burslari`), unchanged 2
- Failed 0, paused 0, unhealthy 0, review 0
- 3 discovery candidates queued in `pipeline/candidates.json`, none published
- `run-status.json` moved to `mode: "live"` because the gate held: `checked > 0`,
  zero failures, zero unhealthy sources, not a dry run

What the live data still cannot show, and why:

- No deadline renders as a date. Groq alone reads them, so they stay
  `provisional` and the UI says "Not confirmed". A second provider
  (`GEMINI_API_KEY` or `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`) is required
  before a deadline can be `verified`.
- No Apply button anywhere, because no cycle has a verified apply URL.
- Funding and eligibility stay behind the "not confirmed" panel until Plan 3
  curation adds an official quote per program.

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

## Daily data pipeline

The robot runs on GitHub Actions, not on a laptop. It reads official pages,
extracts cycles and guides, verifies them with a second model, and commits the
result to `src/data/` and `pipeline/`. Git history is the audit log.

- **Workflow:** `.github/workflows/pipeline.yml`
- **Schedule:** `0 2 * * *` UTC, which is 07:00 in Pakistan
- **Manual run:** GitHub → **Actions** → **Data pipeline** → **Run workflow**
- **Job timeout:** 45 minutes; the loop runs up to 10 segments of 20 items
- **Reports:** `pipeline/runs/` (uploaded as the `pipeline-reports` artifact)

A manual dispatch always checks out `main`, so a feature branch can never
publish data.

### One-time setup (owner)

1. Add the provider secrets you have: **Settings → Secrets and variables →
   Actions → New repository secret**. Names: `GEMINI_API_KEY`, `GROQ_API_KEY`,
   and optionally `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CLOUDFLARE_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`. See
   `.env.example`. With no secrets the run exits 0 and changes nothing.
2. Set **Settings → Actions → General → Workflow permissions → Read and write**.
   The workflow requests `contents: write`; a repository or organization policy
   that caps workflow permissions at read-only will still block the data commit.
3. Run the workflow once by hand and confirm it commits. Only then is the site
   allowed to leave demo mode.

GitHub emails the repository owner when a scheduled workflow fails, so no extra
alert service is needed.

### Source modes

Every entry in `pipeline/sources.json` has a `mode`:

| Mode | Use it for | What the robot does |
| --- | --- | --- |
| `extract` | A page with a machine-readable cycle (dates, apply link, guide) | Reads the page, verifies the facts with a second model, and publishes to `src/data/programs/` |
| `monitor` | An official page with no reliable cycle structure | Fetches and hashes the page only. A change adds a **review needed** item; nothing is published |

Use `monitor` rather than guessing a cycle from prose. A monitor source keeps its
last curated cycle in `src/data/` and never invents a deadline.

### Evidence gates the listing

The listing publishes a funding or eligibility section only when the cycle has a
`funding.*` or `eligibility.*` evidence quote. Without one it shows a neutral
"not confirmed" panel and links to the official page. Cards show
"Funding unconfirmed" instead of a funding label.

The robot does not extract program-level funding or eligibility, so those
sections stay hidden until a human adds a quote (Plan 3 curation). This is
intentional: the site must never publish an unsourced fact. A curated entry
survives later runs because `mergeEvidence` preserves fields the extraction does
not produce.

### Review queue

Monitor sources and suspicious changes are not published. They appear in the run
report (`pipeline/runs/<runId>.json` under `review`, and the `### Review needed`
section of `pipeline/runs/<runId>.md`). To clear an item:

1. Open the official page and confirm what changed.
2. Update the program JSON and `lastVerified` date by hand, or change the source
   to `extract` once the page has a stable cycle structure.
3. Re-run the pipeline. The new hash is recorded, so the item does not repeat.

Review items are a signal, not an error: a clean run can still need review.

### State values

`pipeline/state.json` is the checkpoint. `state.run.status` is one of:

| Value | Meaning |
| --- | --- |
| `running` | A run is in progress; the next segment resumes it |
| `paused` | Stopped on purpose (for example a provider outage); resume by hand |
| `complete` | Finished; the next run starts fresh |
| `failed` | No item could be checked; the next run starts fresh |

Per-item checkpoints live in `state.pages` and `state.sources`. A page whose
content hash is unchanged is skipped, so a quiet day costs almost nothing.

### Resume after a pause

A paused run keeps its item checkpoints. Clear the pause by running the
workflow again; it picks up where it stopped. Do not delete
`pipeline/state.json` to "fix" a pause — that re-fetches and re-spends model
calls.

A short rate limit is not a pause. The router reads `Retry-After` or the
provider's "try again in 9s" message, waits it out (up to 30 seconds, twice),
and retries the same model. A provider is cooled down only when the wait is
longer than that or the retries fail. Monitor sources are checked before
extract sources, so a provider outage never blocks the free hash checks.

### Roll back a bad data commit

1. Find the commit that changed `src/data/programs/`.
2. `git revert <sha>` and push to `main`.
3. Cloudflare rebuilds from the corrected data.

Never hand-edit files in `src/data/`; the robot owns them.

### Discovery queue

New scholarships are never published automatically. Discovery writes
`pipeline/candidates.json` with `status: "pending-review"`. A human reviews
each candidate, adds it to `pipeline/sources.json` and `src/data/programs/`,
and only then does it appear on the site.

Discovery runs after the checks, with hard budgets: 3 rounds, 6 queries per
round, 40 page fetches, 10 accepted candidates per run, and a 35-minute soft
stop. It only writes `pipeline/candidates.json` and `pipeline/state.json`; it
never touches `src/data/programs/`.

To run maintenance without discovery (for example after editing a source):

```bash
npm run pipeline -- --no-discovery
```

### Groq multi-key pool rotation

The pipeline dynamically adapts to any number of Groq keys. It supports both a
single multi-key secret (`GROQ_API_KEYS`) and individual numbered secrets
(`GROQ_API_KEY_1`, `GROQ_API_KEY_2`, etc., alongside legacy `GROQ_API_KEY`).

- **Per-request rotation**: Calls cycle round-robin across ready keys in the pool,
  spreading TPM and RPM limits evenly across all your keys.
- **Failover & skip-and-continue**: If a key hits a rate limit (429) or auth error
  (401/403), that key is cooled down in `pipeline/state.json` and the router immediately
  rotates to the next ready key in the pool without pausing the run.
- **Cooldown recovery**: When keys are cooling, their reset window is respected; as soon
  as a key's reset timestamp passes, it re-enters the active rotation.
- **Inline short wait**: If all keys in the pool are temporarily cooling with short
  resets (<=30s), the router waits out the shortest cooldown and retries.
- **Large-input compaction**: Pages longer than 20,000 characters are automatically
  chunked at paragraph boundaries. Facts and extracted state are compacted and passed
  sequentially across chunks, ensuring complete facts and exact verbatim evidence quotes.

#### How to configure your keys

You can provide your keys in either of two ways:

**Method 1: Single multi-key secret `GROQ_API_KEYS` (Recommended)**
Store all your keys (comma-separated or newline-separated) in one secret. You can
have 8, 15, 50, or 100 keys; the pipeline automatically detects them and scales the pool:

```bash
# In your terminal (any directory where gh is authenticated):
gh secret set GROQ_API_KEYS --body "gsk_key1,gsk_key2,gsk_key3,gsk_key4,gsk_key5,gsk_key6,gsk_key7,gsk_key8"
```

Or multiline from a file or stdin:
```bash
gh secret set GROQ_API_KEYS < /path/to/my-groq-keys.txt
```

**Method 2: Separate numbered secrets**
```bash
gh secret set GROQ_API_KEY_1 --body "gsk_..."
gh secret set GROQ_API_KEY_2 --body "gsk_..."
# ... repeat for as many keys as you have
```

**Method 3: Via GitHub Web UI**
1. Open the repository on GitHub: `https://github.com/abduljawad-ai/scholarship-tracker`
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Under **Repository secrets**, click **New repository secret**.
4. Name: `GROQ_API_KEYS`, Secret: paste your keys (comma-separated or one per line), then click **Add secret**.

Verify the secrets with:
```bash
gh secret list
```

### Annual source URL curation

Official program pages move with each intake (for example a `.../2026` news
page). Before an intake opens:

1. Open the provider's scholarship index and find the current program page.
2. Update `pageUrls` for that source in `pipeline/sources.json`. Keep
   `sourceId` and `programId` stable; they are the identity used by saved
   tracker entries.
3. Keep the old cycle in the program JSON. Add the new cycle; never overwrite
   history.
4. Run `npm run pipeline -- --source <sourceId> --no-discovery` and confirm the
   new cycle, its evidence, and its verification labels.

### When the site leaves demo mode

`src/data/run-status.json` flips to `live` only when a real run checked at
least one item, had zero failures, zero unhealthy sources, and was not a dry
run. Until then the banner stays. Never set `mode: "live"` by hand.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Build fails with “Invalid program file” | The message names the JSON file; fix it against `src/lib/schema.ts`. |
| Sitemap or canonical URLs use the wrong domain | Update `site` in `astro.config.mjs` and the `Sitemap:` line in `public/robots.txt`. Use the stable `scholarships-pk.pages.dev` alias, never a deployment hash URL. |
| “This project is disconnected from your Git account” | Reconnect GitHub in **Settings → Builds & deployments → Git repository**; see “Reconnect Git” above. |
| “Report an issue” points at `OWNER/REPO` | Update `PUBLIC_REPO_URL` in `src/lib/constants.ts`. |
| e2e fails because port 4322 is busy | Stop the stale preview; the Playwright config always builds fresh and refuses to reuse a server. |
| Cloudflare build uses the wrong Node version | Set `NODE_VERSION=24` in the Pages environment variables. |
| Banner says demo data after automation is live | Confirm the robot committed `run-status.json` with `mode: "live"` and a fresh timestamp. |
| Scheduled workflow fails with “push declined” | Workflow permissions are read-only; set **Settings → Actions → General → Workflow permissions → Read and write**. |
| Workflow runs but changes nothing | No provider secrets are set, so the pipeline exits 0 by design. Add at least one key. |
| A run is stuck on `running` | Re-run the workflow; it resumes from the checkpoint. Do not delete `pipeline/state.json`. |
| The same page is checked every day | Its content hash changed, or extraction failed validation. Read `pipeline/runs/` for the reason. |
| A monitor source reports “Review needed” | The official page changed. Confirm the new cycle by hand, update the program JSON, then re-run. If the page keeps changing (news banners, cookie notices), move the source to `extract` once its cycle structure is stable. |
