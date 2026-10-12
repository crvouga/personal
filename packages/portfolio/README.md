# @pkgs/portfolio

Source for [www.chrisvouga.dev](https://www.chrisvouga.dev): an Astro 7 static site, its content registry, generated assets, resume PDF, and container image.

The package is a Bun workspace inside `crvouga/workspace`. The production image (`ghcr.io/crvouga/chrisvouga-portfolio`) is built from the repository root by CI using `packages/portfolio/Dockerfile`, then served by nginx. Hosting is declared in [`packages/infra/tofu/modules/inventory/inventory.tf.json`](../infra/tofu/modules/inventory/inventory.tf.json) (`id: portfolio`).

## Architecture

Astro static output emits a small set of HTML pages — `/`, `/projects/`, `/404` — each with its CSS inlined and no client framework. Runtime JavaScript is limited to copy-to-clipboard feedback, the native project gallery dialog, and the lazy YouTube embed. There is no analytics or runtime API dependency except the embedded video.

`src/content/**` is a typed TypeScript registry (projects, work, school, topics, skills) shared by the site, the resume PDF, and the screenshot job list.

### Resume PDF

`/chris-vouga-resume.pdf` is **generated during `astro build`**, not committed. [`src/pages/chris-vouga-resume.pdf.ts`](src/pages/chris-vouga-resume.pdf.ts) assembles [`src/resume/content.ts`](src/resume/content.ts) from the same modules the site renders — the hero statement becomes the summary, `work.ts` highlights become the bullets, the homepage's featured side projects become Projects, and skills are ranked by how often those projects use them. So the PDF cannot drift from the site: editing content is the only way to change it.

Rendering is Playwright's Chromium ([`src/resume/pdf.ts`](src/resume/pdf.ts)), which keeps the text a real text layer for applicant tracking systems. Because the build shells out to Chromium, the Docker build stage is Debian with `playwright install chromium`, and CI installs it before `bun run check`.

Every candidate layout must pass all four checks before its bytes are returned, and a candidate that fails any of them is reduced (per [`src/resume/reductions.ts`](src/resume/reductions.ts)) and re-checked:

| Check               | Catches                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Rendered height     | Content taller than the printable area — the usual overflow.       |
| Element bounds      | Anything crossing the page edge, e.g. an unbreakable URL, clipped. |
| Empty sections      | A section heading left with no rows after trimming.                |
| Real PDF page count | A second page, checked on the actual bytes rather than assumed.    |

Trimming never drops a role, and the page is filled before anything is cut. When a trim happens the build prints `[resume] trimmed to fit one page: …`, so content outgrowing the page is visible rather than silent. If every reduction is exhausted the build fails with what was left, so a broken resume can never deploy. `src/resume/pdf.test.ts` renders the real PDF and asserts these properties, including for deliberately oversized content and an unbreakable URL.

### Share card

`/og.png` is the image LinkedIn, X, Slack and iMessage show for a shared link. Like the resume it is **generated during `astro build`** ([`src/social/`](src/social/), served by [`src/pages/og.png.ts`](src/pages/og.png.ts)) from the hero copy, so it cannot disagree with the page it previews. It is a 1200×630 PNG: that ratio renders uncropped on both platforms, and PNG because preview crawlers do not reliably decode WebP. Text that outgrows the card fails the build rather than shipping clipped.

The meta tags reference it as `/og.png?v=<content hash>`. nginx serves images with a year-long immutable cache and every platform keeps its own copy per URL, so a changed card must be a new URL. A platform still shows its cached preview for links shared earlier; LinkedIn's Post Inspector re-scrapes on demand.

`/apple-touch-icon.png` (the monogram) is generated the same way for iOS share sheets and bookmarks. `src/lib/seo.test.ts` and `src/social/card.test.ts` pin the image format, size and ratio, the title and description lengths, and the overflow check.

`@astrojs/sitemap` generates `sitemap-index.xml` + `sitemap-0.xml`; there is no `public/sitemap.xml`. `nginx.conf` deliberately does **not** fall back to the homepage — an unknown path is a real 404 serving `dist/404.html`.

GitHub proof data is fetched at build time by [`src/lib/github.ts`](src/lib/github.ts) using `PORTFOLIO_GITHUB_TOKEN` (a user token with `read:user`). The proof section offers a period picker — the trailing twelve months plus every calendar year back to the one the account was created in (the profile's `created_at` bounds it; years with no contributions are dropped). All periods are fetched in one aliased GraphQL document, and the picker CSS is index-independent, so adding years needs no CSS change. Shades are quartiles of each period's own active days rather than GitHub's fixed 1/3/6/10 buckets, which would saturate a high-volume account into a single flat colour. The picker itself is pure CSS (`:checked` sibling rules), so it works without JavaScript.

### Build-time uptime

A GitHub incident, an expired token, or a rate-limit window must not be able to take the build down. [`src/lib/github-insights.ts`](src/lib/github-insights.ts) applies, in order:

1. live GitHub data, retried with backoff on network errors, 429, 5xx, and the transient GraphQL failures GitHub reports with HTTP 200 (`RATE_LIMITED`, backend timeouts) — a success also rewrites the snapshot;
2. the committed snapshot [`src/data/github-insights.json`](src/data/github-insights.json), rendered with a visible `Last known snapshot …` caption that states how old it is;
3. otherwise a notice card in `astro dev`, or a hard build failure in production.

When GitHub names its own wait (`Retry-After`, or `x-ratelimit-reset` on a spent quota) that wait is honored in place of the backoff curve — except when it is longer than `MAX_RETRY_WAIT_MS`, which is treated as _not_ retryable, because a build should reach for the snapshot rather than idle out a rate-limit hour.

The snapshot is a normal source file so it is present in the Docker build context. Days are stored as a first-day date plus a flat count array, one number per line, to keep diffs small.

## Staying fresh

The site is static, so the numbers are frozen at image-build time. The `schedule:` cron in [`ci.yml`](../../.github/workflows/ci.yml) is what keeps them moving:

- it rebuilds and redeploys the portfolio image daily, and that build fetches GitHub live — so the deployed page is never more than a day behind;
- the `refresh-github-insights` job runs `bun run refresh-github` and lands the rewritten snapshot on `main` through a self-merging bot PR, so the offline fallback moves forward on its own instead of waiting for someone to remember. It is a PR rather than a push because the `main` ruleset requires one and has no bypass actors, and it is opened with `DEPLOY_DISPATCH_TOKEN` because a PR from the default `GITHUB_TOKEN` never triggers `on: pull_request` — `Required` would not report and auto-merge would wait forever.

That job is deliberately _not_ a dependency of `publish`. If the token expires it goes red while the build carries on serving the last good snapshot — an alarm, not an outage. It is also strict where the build is forgiving: it never falls back, because a refresh that silently served yesterday's data would report success forever.

[`src/lib/github-freshness.ts`](src/lib/github-freshness.ts) holds the budget. Past `STALE_AFTER_DAYS` the build log warns that the schedule has stopped landing; past `VERY_STALE_AFTER_DAYS` the caption stops implying the figures are current and says they are as of that date. Nothing here can fail a render — stale data still draws the full heatmap.

The preferred local entry point is `bun portfolio`, which wraps the dev server in `vault run --config dev` and always starts `astro dev --force`.

## Layout

| Path                                 | Purpose                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `astro.config.mjs`                   | Static Astro config and canonical site URL.                                   |
| `src/pages/index.astro`              | Homepage composition and recruiter-first section order.                       |
| `src/pages/projects.astro`           | Full project archive; the homepage shows only the leading flagship entries.   |
| `src/pages/404.astro`                | Emitted to `dist/404.html`; served by the nginx `error_page`.                 |
| `src/lib/seo.ts`, `seo-json-ld.ts`   | Per-page title/canonical/OG/JSON-LD.                                          |
| `src/social/`, `src/pages/og.png.ts` | Share card and touch icon, rendered to PNG from content at build time.        |
| `src/layouts/Page.astro`             | Sub-page chrome for `/projects/` and `/404`.                                  |
| `src/components/`                    | Nav, Hero, Work, Projects, Proof, About, Toolbox, Contact, sticky CTA, icons. |
| `src/lib/github.ts`                  | Build-time GitHub GraphQL/REST fetch, validation, streaks, and errors.        |
| `src/lib/github-insights.ts`         | Uptime policy: live data → committed snapshot → notice/failure.               |
| `src/lib/github-cache.ts`            | Compact snapshot read/write and structural validation.                        |
| `src/lib/github-ranges.ts`           | The selectable contribution periods and their GraphQL bounds.                 |
| `src/lib/github-levels.ts`           | Per-period quartile thresholds behind the heatmap shades.                     |
| `src/lib/heatmap-grid.ts`            | Weekday-accurate column/row geometry and month labels.                        |
| `src/data/`                          | Committed GitHub snapshot (generated).                                        |
| `src/lib/projects-view.ts`           | Shared visible-project ordering and typed gallery payload.                    |
| `src/layouts/Base.astro`             | Document head, OG/JSON-LD metadata, global copy feedback script.              |
| `src/styles/global.css`              | Dark design tokens, typography, layout primitives, focus styles.              |
| `src/content/`                       | Typed content registry, skills, work, education, and project data.            |
| `assets/`                            | Source screenshots/photos. Not served and excluded from the Docker context.   |
| `public/`                            | Served derivatives, fonts, icons, robots.txt. No sitemap, no resume PDF.      |
| `scripts/optimize-images.ts`         | Converts raster sources in `assets/` to 1400px WebP derivatives.              |
| `scripts/prune-unused-assets.ts`     | Dry-run/apply asset reference hygiene.                                        |
| `scripts/health-check-urls.ts`       | Checks every public URL referenced by content.                                |
| `scripts/refresh-github-insights.ts` | Strict live fetch that rewrites the committed snapshot; run daily by CI.      |
| `Dockerfile`, `nginx.conf`           | Container build and static server.                                            |
| `test/server.test.ts`                | Local Docker E2E smoke test.                                                  |

## Scripts

Run from the repository root with `bun run --filter @pkgs/portfolio <script>`, or from this directory with `bun run <script>`.

| Script                                                        | Purpose                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dev`                                                         | `astro dev --force`; direct package development server.                                           |
| `build`                                                       | Static Astro build into `dist/`. Requires GitHub proof credentials in production.                 |
| `assets:optimize`                                             | Rebuild every `public/**/*.optimized.webp` from `assets/` using ImageMagick.                      |
| `assets:prune`                                                | Report unused files; add `-- --apply` to move/delete them.                                        |
| `gen` / `generate-all`                                        | Capture hosted screenshots into `assets/` and optimize derivatives.                               |
| `screenshot-work` / `screenshot-projects` / `screenshot-main` | Capture one screenshot collection into `assets/`.                                                 |
| `health-check-urls`                                           | GET every public URL in content; exits non-zero on failure.                                       |
| `refresh-github`                                              | Refresh the committed GitHub snapshot; exits non-zero if the live fetch fails.                    |
| `check-github-freshness`                                      | Report the snapshot's age; exits non-zero once it is stale.                                       |
| `preview`                                                     | Build the Docker image with `PORTFOLIO_GITHUB_TOKEN` as a BuildKit secret and serve on port 8080. |
| `tc`                                                          | `astro check` for TypeScript and Astro files.                                                     |
| `lint`                                                        | ESLint with the shared workspace rules.                                                           |
| `test`                                                        | Bun tests under `src/`; Docker E2E is intentionally excluded.                                     |
| `test:docker`                                                 | Local Docker E2E; requires Docker and `PORTFOLIO_GITHUB_TOKEN`.                                   |

## Local development

Install the workspace once from the repository root:

```bash
bun install
```

Preferred development command (Vault injects the dev secrets and `--force` clears Astro's content-layer cache):

```bash
bun portfolio
```

Equivalent package command with a local token:

```bash
cp packages/portfolio/.env.example packages/portfolio/.env
# edit packages/portfolio/.env and set PORTFOLIO_GITHUB_TOKEN
bun run --filter @pkgs/portfolio dev
```

Build through Vault:

```bash
bun portfolio:build
```

Run the full local generation pipeline (hosted screenshots + optimized derivatives):

```bash
bun portfolio:gen
```

Image sources are committed under `assets/`; only optimized WebP derivatives are served from `public/`. After adding or changing a source, run:

```bash
bun run --filter @pkgs/portfolio assets:optimize
bun run --filter @pkgs/portfolio assets:prune
```

The Docker E2E is intentionally local-only:

```bash
vault run --config dev -- bun run --filter @pkgs/portfolio test:docker
```

## Content

`projects.ts` is the source of truth for project listings. Entries are split across `src/content/projects/entries-part-1.ts` and `entries-part-2.ts` to stay under the repository file-size limit; append new projects to `entries-part-2.ts`.

`entries-archive.ts` holds early and small work (games, toys, client sites) as `ARCHIVE_PROJECTS`. It is deliberately **not** part of `PROJECTS`, so it never reaches the homepage, the Toolbox stack, the screenshot jobs, the resume or the URL health check — `/projects/` renders it behind the "Everything else" fold so nothing built is lost.

### Copy rules

Hand-written prose states what stays true; anything that moves is derived. `src/content/copy.test.ts` enforces it:

- **No numbers in prose.** Counts and dates drift from the day they are typed. Totals, tenure, the copyright year and the GitHub figures are computed at build time.
- **No technology names in prose.** The stack is an implementation detail; topic chips, the Toolbox and the resume's Skills derive it from each project's `topics`.
- **Project descriptions are one brief, plain-text thought** — what the project is and, for client work, what I did on it. No markup and no links: cards render them as text, and `deployment`/`code` already carry the links.
- **Identity is declared once.** `NAME`, `ROLE` and `LOCATION` in `src/content/hero.ts` feed the page title, eyebrow, footer, meta tags and JSON-LD.

Work highlights are authored in `src/content/work.ts` and are rendered by both the site cards and the resume bullets. `src/content/skills.ts` is shared by the About Toolbox and the resume.
