# Prompt: make chrisvouga.dev audit-proof for senior/staff hiring (agentic-era, late 2026)

Paste everything below this line into Claude Code (or Codex/Cursor) from the root of `crvouga/workspace`. It is a backlog of issues plus a mandatory self-audit protocol. Work the issues top to bottom (ordered by hiring leverage), one PR each, then run the audit protocol in Part 4 until it finds nothing. **The bar: a fresh, adversarial auditor given Part 5's checklist should find nothing material.**

---

# Part 0 — Context, lens, and hard rules

## Where you are

`packages/portfolio` in the `crvouga/workspace` monorepo: Astro 7 static site, Bun, Turborepo, nginx in Docker, built and redeployed daily by `.github/workflows/ci.yml`. Read root `AGENTS.md` and `packages/portfolio/README.md` first. Content lives in a typed registry under `src/content/**` that feeds the pages, the generated résumé PDF (`src/resume/`), the OG card (`src/social/`), and the screenshot jobs. **Keep that architecture**: content changes go in the registry, never in components; derived values stay derived. Every PR must pass `bun run check` and `bun test src`.

## The outcome every change is judged against

A hiring manager or recruiter for a senior/staff software-engineering role, in late 2026, should within 60 seconds on this site: (a) understand what Chris is uniquely good at, (b) see hard, linked evidence of it, (c) find no reason to doubt it, and (d) have a frictionless way to start a conversation. Then they open the GitHub profile and the résumé PDF and see the same story.

## The 2026 hiring lens

- Every team uses AI coding agents now. "I use AI" is table stakes. The differentiator is **demonstrated control of agent output**: specs, automated verification, CI gates, review discipline, and evidence that shipped work was correct.
- Raw commit volume is a _negative_ signal to experienced reviewers. A 24k-contribution year with a 1,587-commit day reads as agent spam unless the page proves otherwise. Volume is never the headline.
- Reviewers open three things in order: site → GitHub profile → résumé PDF. All three must agree.
- Reviewers skim for **numbers and named artifacts**. Qualitative bullets are skipped.
- Recruiters run AI screening agents over candidate pages. Machine-readable candidate data matters (JSON-LD, JSON Resume, a candidate-facing `llms.txt`).
- Senior vs. staff is filtered on scope and leadership evidence, not on effort.
- Anything that a reviewer could _catch_ — an inconsistency, a broken link, a contrast failure, a stale repo — costs more than it would on an ordinary site, because this site's entire pitch is "I verify everything."

## Hard rules

1. **Never fabricate** a metric, user count, percentage, date, customer, team size, testimonial, or quote. Where a fact is needed and not derivable from the repos, insert `{{NEEDS_INPUT: one-line description}}` and add the question to `packages/portfolio/CONTENT_QUESTIONS.md` (create it; seed it from Part 6). A test must fail while any placeholder remains, so nothing half-finished deploys.
2. Preserve and strengthen the honesty signals: the "Hand-written" badge, the "figures come from GitHub, not me" framing, the snapshot-age caption, the "private deployment"/"no longer hosted" labels.
3. Preserve the build-time guarantees: one-page résumé fit checks, OG overflow check, no client frameworks, no trackers, real 404s.
4. No padding. Every added sentence carries a fact, a number, or a link. If a sentence could appear on any engineer's site, delete it.
5. One PR per issue, issue title as PR title, body = what changed / what was verified / what still needs Chris. Conventional commits (commitlint is configured).
6. When an issue conflicts with an existing test or rule, change the test deliberately and say why in the PR — do not weaken it silently.

---

# Part 1 — Verified findings (evidence already gathered; fix every one)

These were confirmed on the live site and a local build on 2026-10-26. They are referenced by number from the issues below.

**Content and positioning**

- F1. Homepage button reads **"Browse all 17 projects →"**; `/projects/` says **"All 26 projects"**. `Projects.astro` renders `archiveCount`, not the total. A reviewer who notices this on a site that promises verification is done.
- F2. Zero quantified outcomes in any work highlight. `src/content/copy.test.ts` → `"no numbers: counts and dates are derived, never typed"` forbids any digit in `work.highlights[]`. The rule was meant for drifting counts; it is blocking completed-outcome metrics.
- F3. Geviti highlights are present-tense job-description bullets ("Build member-facing features…"), not accomplishments.
- F4. Role dates are year-only. One Origin ends 2025, Geviti starts 2026; the GitHub graph is near-empty Aug–Oct 2025. The gap is visible and unexplained.
- F5. The hero's differentiator (spec-first, verification-gated agents) is the smaller secondary line. The "currently" card duplicates hero content.
- F6. "Proof, not promises" leads with 24,496 contributions, a 76-day streak, "85 public repos", and a 1,587-contribution day; Sep–Oct 2026 is ~20× the baseline. The daily `refresh-github-insights` bot PR and maintenance workflows are counted. The lede pre-apologizes instead of proving.
- F7. "How I build" has four unfalsifiable principles and no linked artifact, while the repo contains `AGENTS.md` hard rules, `.agents/commands/pr-ready.md`, résumé/OG build-failing tests, `bun run health`, OpenTofu `prevent_destroy` guards, and Mockingbird's property-based parity tests.
- F8. The Cursor "top Tab user" video is the largest element in "How I build", the only third-party runtime dependency (YouTube iframe), and a 2024-era signal.
- F9. Mockingbird (771 commits, published npm packages, CLI, `/__admin` control plane, docs site, MIT) is a one-line card in third position with no numbers and no demo. It has **56 open issues and 2 open PRs** visible on GitHub.
- F10. The workspace platform itself (OpenTofu-only infra, OpenBao, Turborepo remote cache, auth relay, daily drift/health report, signed images) is invisible except a footer link. The Toolbox lists Heroku and Vercel instead.
- F11. `/projects/` has 26 entries including Simon Says, Snake, Match Three, Anime Blog, Fullstack Todo, a courier marketing site. Geviti appears as both Work and Project. gamezilla (lead card) has no code link and no statement of what is hard about it.
- F12. No writing anywhere. No testimonials or recommendations anywhere (One Origin awards exist only as images). No mention of external open-source contributions, talks, or community work.
- F13. Toolbox is a flat alphabetical list including Bootstrap, Redux Saga, Graphene, Neo4j, Ramda-era stacks. `Go` and `Rust` appear on the site but not the résumé; Docker, OpenTofu, NixOS, GitHub Actions, Playwright appear nowhere on the résumé.
- F14. No work-authorization, time-zone, start-date, or "what I'm looking for" line. These are the first three recruiter filters.
- F15. Contact email is `crvouga@gmail.com` while the site is `chrisvouga.dev`. X handle is the auto-generated `@ChristopherVou7`. Résumé PDF publishes a phone number on an indexable URL.
- F16. "CV" nav monogram reads as "curriculum vitae".
- F17. Hero says "Open to senior and staff roles" while 10 months into the current senior role; the page never addresses why. (Decision for Chris; see Part 6.)

**Accessibility (measured)**

- F18. `--text-subtle #727a88` on `--paper #101013` = **4.39:1** (fails WCAG AA 4.5:1 for normal text; used on card metadata/captions). On `--bg` it is 4.58:1 — borderline.
- F19. White text on `--accent-strong #4c8de8` (primary **Email** button) = **3.34:1** — fails AA for normal-size text.
- F20. Three project screenshots share the alt text "A screenshot of the project". Fifteen images have empty alt (acceptable only if decorative — the tech-chip icons are, but verify each).
- F21. Repeated ambiguous link text: "Live" ×3, "Images" ×3, "Code", "Résumé" ×4, "Email" ×3 (WCAG 2.4.4). Screen-reader users get a list of identical links.
- F22. Heading order: the hero's "currently" card renders `<h2>Geviti</h2>` before the `<h2>Work</h2>` section, so the outline reads Geviti → Work → Geviti.
- F23. Dark-only. No `prefers-color-scheme: light` and **no print stylesheet** — reviewers print pages and the dark theme prints as black pages. (`prefers-reduced-motion` and `:focus-visible` are handled — keep them.)
- F24. The 1,759-`<rect>` heatmap with 1,681 per-day `<title>`s is a screen-reader trap and 260 KB of the 320 KB homepage HTML (33 KB gzipped, so not a bandwidth problem, but a DOM/parse-time one on phones).

**Mobile**

- F25. `StickyCta.astro` hides only when the Contact section is in view, so on first paint on a phone the sticky Email/Résumé bar sits directly under the hero's identical Email/Résumé buttons — duplicate CTAs above the fold.
- F26. Mobile page height is 9,280 px; the five-period heatmap and the full Toolbox dominate the scroll.

**Infrastructure / headers**

- F27. `nginx.conf`: `add_header` inside `location` blocks **replaces** the server-level `add_header`s (nginx inheritance rule), so static assets and the résumé PDF are served **without** `X-Frame-Options` and `X-Content-Type-Options`. No `Strict-Transport-Security`, no `Content-Security-Policy`, no `Referrer-Policy`, no `Permissions-Policy`. `X-XSS-Protection` is deprecated and should be removed. No Brotli. (Check whether the edge in front of Railway adds any of these before duplicating.)
- F28. No `manifest.webmanifest`, no SVG favicon (only `favicon.ico` + generated `apple-touch-icon.png`), no RSS (none needed until Issue 11 lands, then required).
- F29. Résumé PDF metadata has `/Title` and `/Creator: Chromium` only — no `/Author`, `/Subject`, `/Keywords`. Text layer and headings extract cleanly (verified with pypdf and pdftotext); keep it that way and add a test.
- F30. `/llms.txt` is the monorepo's _infrastructure integration guide_, not candidate information. An AI screener fetching it learns about Vault paths and R2 buckets.

---

# Part 2 — P0 issues (highest leverage)

### Issue 1: Fix the project-count mismatch and add a test (F1)

- `Projects.astro`: render the true total of listed projects, derived from the registry (and after Issue 10's curation, the number of non-archived projects, with the archive count stated on `/projects/`).
- Test: the homepage link text number equals the count rendered on `/projects/`.

### Issue 2: Quantify every work bullet; make the tests require it (F2, F3, F4)

- Change `copy.test.ts`: still forbid **years** and **live totals** in prose (keep them derived); **require** every `work.highlights[]` entry for the Geviti and One Origin roles to contain a digit, `%`, `$`, or a link to a named artifact. Keep the no-technology-names rule.
- Add a test: build fails if any content string contains `{{NEEDS_INPUT`.
- Rewrite every highlight as situation → action → measured result, past tense for completed work. Geviti: what has shipped since joining, not the job description.
- Role dates: `yearStart/yearEnd` → full dates; render "Jan 2026 – Present". Résumé and JSON-LD derive from the same field.
- One Origin: add one bullet evidencing staff-level scope (team led, stakeholders, decisions owned). Triangulator: institutions, evaluations processed, staff hours saved — `{{NEEDS_INPUT}}` each.
- The 2025→2026 gap: add a one-line honest explanation in `work.ts` if Chris supplies one (Part 6), rendered between the roles; otherwise leave the months visible and say nothing false.
- Résumé fit: prefer shortening bullets over letting the trimmer drop them; check the `[resume] trimmed` build log.

### Issue 3: Rewrite the hero around the differentiator (F5, F16, F14)

- `hero.ts`: primary statement = method + outcome (≤30 words, shape: _I ship production software where being wrong is expensive, by writing the spec and the automated checks first, so AI coding agents can do the volume and the pipeline guarantees the bar_); secondary = domains/scope.
- Replace the "currently" card with three **proof chips** linking into the page, each with a build-time number: gates per merge (Issue 5), Mockingbird services mocked (Issue 7), "Tech lead, Triangulator" (→ #work).
- Add a **logistics line** under the availability pill: work authorization, time zone, remote/hybrid preference, earliest start — `{{NEEDS_INPUT}}` each (F14).
- Rename the monogram: full name or "C.V." with `title="Chris Vouga"`.
- `seo.ts`: title/description to match; description must include "AI coding agents" or "agentic"; keep the length tests green.
- Fix F22: the hero card must not use `<h2>`; use a `<p>` with a visually-styled label or `<h3>` under an `aria-labelledby` group.

### Issue 4: Replace proof-of-volume with proof-of-verification (F6, F24)

- Retitle to **"Verified, not just shipped"**. Lead with build-time metrics from the repos Chris owns (`workspace`, `mockingbird`, `headless-combobox`, `llm-server`, `violets-garden`, `gamezilla` if public):
  - gates per merge in `workspace` (count required checks + CI jobs/steps in `ci.yml`),
  - test count (count `test(`/`it(` via a build-time script),
  - CI pass rate on `main`, last 90 days (Actions REST API),
  - PRs merged, and **PRs that failed CI at least once before merging** — the "the pipeline caught it" stat; make it the first tile.
  - Use the same retry + committed-snapshot + stale-warning pattern as `github-insights.ts`; `bun run check` must pass with no secrets by falling back to the snapshot.
- **Bot filter**: exclude commits/PRs by `[bot]` authors and by the scheduled workflows (match known PR titles/branches). Caption: "excludes N automated commits". If the contribution calendar cannot be filtered, show REST PR/review counts instead of raw contributions.
- Demote the heatmap: one period rendered by default, others on demand; per-row `aria-label` instead of 1,681 per-day `<title>`s; keep the "verify on GitHub" link and the snapshot-age caption. Remove the "public repos" and "streak" tiles.
- Target: homepage HTML < 100 KB uncompressed.
- If any single day in the displayed period exceeds 10× the period median, render a footnote explaining it (`{{NEEDS_INPUT}}` for the reason, e.g. a migration or bulk import).

### Issue 5: "How I build" → with receipts (F7, F8)

- Keep the four principles as headers; under each, **one linked receipt**:
  - _Start from the spec_ → `packages/auth-relay/acceptance.md` (or the best real spec in the repo) + `.agents/commands/pr-ready.md`.
  - _Make verification automatic_ → `src/resume/pdf.test.ts`, `src/social/card.test.ts`, the ESLint structural size-limit rule named in `AGENTS.md`.
  - _Let the pipeline decide_ → `ci.yml`, the merge-queue/required-check ruleset, the gate count from Issue 4.
  - _Own the outcome_ → `bun run health` (`packages/infra/lib/health/`), the daily Maintenance job, `prevent_destroy` guards.
- Add **"A change, end to end"**: one real `workspace` PR where an agent drafted, CI rejected, the fix landed, merged. Four sentences, links to the PR and the failing run. Find it by scanning PR history for a red check followed by green.
- Add a one-line **tooling** statement naming the actual tools (confirm from `.claude/`, `.cursor/`, `.agents/`, `AGENTS.md`: Claude Code, Codex, Cursor, MCP servers — only what is true). Principles stay vendor-neutral; this line is explicit for keyword matching.
- Link the `AGENTS.md` as "the contract every agent in my repos works under".
- Cursor recognition → one sentence with the badge, no video. Remove the YouTube iframe and its lazy-load script. The page must have **zero third-party runtime requests**.
- Add one candid paragraph: a time the method failed or an agent mistake reached production and what changed afterwards (`{{NEEDS_INPUT}}`). Auditors look for candor; its absence reads as marketing.

### Issue 6: Case-study pages for three flagship projects (F9, F11)

- Add `src/pages/projects/[slug].astro` driven by an optional `caseStudy` field on the project type. Only projects with a case study get a page.
- Standard case-study format (enforce with a type and a test): Problem · Constraints · Design · **How correctness is enforced** · Outcome (numbers) · What I'd do differently · Links (code, live, docs). 350–600 words. One hero image or GIF/WebM ≤ 2 MB, recorded with Playwright in `scripts/` so it can be regenerated.
- Write three: **Mockingbird** (headline: parity random-walks against vendored OpenAPI contracts and live sandboxes; numbers pulled at build time: packages published, services mocked, tests, commits), **Workspace platform** (Issue 7), **Triangulator** (private: architecture, decisions, outcomes with `{{NEEDS_INPUT}}`; state the deployment is private).
- Per-page OG image via the existing generator (per-page title), per-page `<title>`/description, `BreadcrumbList` JSON-LD, sitemap entries, and the copy tests applied to case-study prose.
- Mockingbird card → first position with a one-line "why it matters" subline.

### Issue 7: Surface the workspace platform (F10)

- Project entry "Workspace platform" + case study: what it runs, the OpenTofu-only rule and why, the health/drift loop, how agents are constrained (`AGENTS.md`), signed images. Inline SVG architecture diagram that is legible in dark, light, and print.
- Toolbox (Issue 12) updated accordingly.

### Issue 8: Résumé PDF alignment and ATS hardening (F2, F13, F15, F29)

- Skills: pinned **"AI-assisted engineering"** row (only true tools: Claude Code · Codex · Cursor · MCP · spec-driven development · CI-gated agent workflows · property-based testing); Infra row adds Docker, OpenTofu/Terraform, NixOS, GitHub Actions, Playwright, Cloudflare, Railway. Keep the usage-ranking rule for the rest.
- Projects: three entries (Mockingbird, Workspace platform, headless-combobox or gamezilla), each with a one-line outcome and short URL.
- Month dates (Issue 2). Quantified bullets (Issue 2).
- PDF metadata: `/Author`, `/Subject` ("Résumé — Senior Software Engineer"), `/Keywords` (derived from the skills registry). Test it.
- Phone number behind `RESUME_INCLUDE_PHONE` (default off for the public URL); document how to build the full version for direct applications.
- ATS test: `src/resume/pdf.test.ts` additionally asserts that `pdftotext`/pypdf extraction yields the section headings as single words (`EXPERIENCE`, `SKILLS`…), every bullet as one line, and that no letter-spacing artifacts appear.
- Add `/resume.json` ([JSON Resume](https://jsonresume.org/schema/)) generated from the registry; validate against the schema in a test; link it from the footer and `llms.txt`.
- Filename stays stable (`chris-vouga-resume.pdf`), `Cache-Control: no-cache` stays.

### Issue 9: GitHub profile (generated here, applied by Chris)

- `bun run gen:profile-readme` → `packages/portfolio/generated/github-profile-README.md` from the registry (hero line, three flagships with outcomes, "How I build" headers with links, contact). Test for drift.
- PR body + `CONTENT_QUESTIONS.md` instructions for Chris: create `crvouga/crvouga`, commit the README; bio = hero line + "Open to senior/staff roles"; pins in order `mockingbird`, `workspace`, `headless-combobox`, `gamezilla` (if public; if private, say so on the site card), `llm-server`, `violets-garden`.
- Repo hygiene on every pinned repo (F9): README with what/why/run-in-60s + screenshot; **triage Mockingbird's 56 open issues** (label, close stale, pin a roadmap issue) and **merge or close its 2 open PRs**; add a `SECURITY.md` and license badge; ensure CI badge is green; archive truly dead repos so "85 public repos" becomes a curated set. The flagship repos are read as work samples — they must look maintained.

---

# Part 3 — P1 and P2 issues

### Issue 10: Curate projects (F11)

- Homepage: exactly three cards (Mockingbird, Workspace platform, one of gamezilla/Triangulator), each with a subline and case-study link.
- `/projects/`: keep the "Hand-written" badge. Move "Everything else" + Pickflix, Cheese, Airr demo, Courier site into a collapsed **Archive** (one line each, no screenshots, no chips). Remove the Geviti project card.
- gamezilla: code link or "source private — architecture:" note; one sentence on the real-time/multiplayer design (WebSockets, state authority, reconnection).
- Test: every homepage project has a `Code` link or a case study.
- Every screenshot gets a specific alt (F20): "Mockingbird admin UI showing the request journal for a Stripe mock", not "A screenshot of the project". Verify each `alt=""` is truly decorative.
- Ambiguous link text (F21): `aria-label="Open gamezilla.app (live)"`, `aria-label="Screenshots of Mockingbird"`, etc.; or make visible text specific. Test: no two links on a page share text+href-target class with different destinations.

### Issue 11: Writing section (F12)

- `src/content/writing/` as an Astro content collection; `/writing/` index; per-post pages with OG cards; RSS at `/rss.xml` (F28); `<link rel="alternate">` in `<head>`.
- Three drafts from real repo artifacts, 800–1200 words, `draft: true`, each listing what Chris must verify:
  1. _Agents draft; the pipeline is the gate_ — the concrete gates, the structural lint limits, the résumé fit check, one real caught mistake.
  2. _Mocking a vendor API faithfully: property-based parity tests_ — from Mockingbird's testing docs.
  3. _What an AGENTS.md should actually contain_ — the hard rules in this repo and why each exists.
- Nav link; "How I build" links to post 1.

### Issue 12: Toolbox depth over breadth (F13)

- Two tiers derived from the registry: **Primary** (current work or ≥ N projects) and **Also shipped with** (collapsed by default). Add the AI-assisted engineering row. Keep derivation tests.

### Issue 13: Social proof (F12)

- Add a **"What people say"** block: 2–3 short quotes from managers/colleagues with name, title, and a link (LinkedIn recommendation or public source). All `{{NEEDS_INPUT}}`; the block does not render until filled; a test forbids rendering an empty or placeholder quote.
- Render the One Origin quarterly awards as text with dates (they are images only), and ask Chris for the citation text (Part 6).
- Add a line for external open-source contributions, talks, or community work if any exist (Part 6); omit the block entirely if none.

### Issue 14: Contact friction (F14, F15)

- Under "Get in touch": what I'm looking for (team type, stage, remote/TZ) and response time — `{{NEEDS_INPUT}}`.
- `mailto:` with a prefilled subject (`?subject=Role at {company}` is not possible statically; use `?subject=Hello from your site`).
- Email on a domain address (`chris@chrisvouga.dev` → forward to Gmail) if Chris sets it up (Part 6); otherwise keep Gmail.
- X: keep only in the footer; if the handle is unchangeable and the account inactive, drop it. Keep the band link in About.
- Optional scheduling link if Chris has one. No contact form.

### Issue 15: Machine-readable candidate data (F30)

- JSON-LD `Person`: `jobTitle`, `knowsAbout` (from skills), `hasOccupation`, `alumniOf`, `sameAs` (GitHub, LinkedIn), `url`, `address.addressLocality`. Validate structure in a test (schema.org types present, no empty fields).
- Serve a **candidate-facing** `/llms.txt` on the portfolio (summary, roles with outcomes, flagships with links, how to contact, link to `/resume.json`), generated from the registry with a drift test. Move the infra guide to `/llms-infra.txt` or keep it only in the repo; update the root `README.md` reference.
- `robots.txt`: keep allow-all; add the sitemap (already present). Do not block AI crawlers — screening agents are the audience.

### Issue 16: Accessibility conformance (F18–F24)

- Fix contrast: `--text-subtle` ≥ 4.5:1 on both `--bg` and `--paper`; primary button text ≥ 4.5:1 (darken `--accent-strong` or use dark text on the light accent). Add a test that computes contrast ratios for every text/background token pair used in `global.css`.
- Heading order fix (F22). Landmarks: one `<main>`, `<nav aria-label>`, `<footer>`. Section headings numbered "01" must not be read as "zero one" — mark the numeral `aria-hidden`.
- Heatmap: `role="img"` with a summarizing `aria-label` per period; keyboard-reachable period picker (it is CSS `:checked` — verify the radio inputs are focusable and labelled).
- Gallery dialog: focus trap, `Escape`, restore focus, `aria-modal` (tests exist in `gallery-dialog.test.ts` — extend).
- Run axe (`@axe-core/playwright`) against `/`, `/projects/`, a case study, and `/writing/` in `test/`; zero violations is a CI gate.
- Tap targets ≥ 44 px (the `--tap` token exists; assert on every interactive element in a Playwright test).

### Issue 17: Light theme and print (F23)

- Add a light theme via `prefers-color-scheme: light` using the same tokens (the OG card and résumé already use light backgrounds — keep the brand consistent). Optional manual toggle persisted in `localStorage`, no flash on load.
- Print stylesheet: white background, black text, URLs expanded after external links, heatmap and gallery hidden, résumé link printed.
- Verify the OG card renders correctly in both Slack and LinkedIn preview sizes (the generator already asserts 1200×630).

### Issue 18: Mobile polish (F25, F26)

- `StickyCta.astro`: hide while the hero CTAs are in view **and** while Contact is in view (second `IntersectionObserver` target). Test the behavior.
- Mobile height: after Issues 4/10/12, target ≤ 6,000 px on a 390 px viewport. Horizontal scroll of the heatmap must be a contained scroll region with a visible affordance.
- Nav: verify all items reachable and no overflow at 320 px.

### Issue 19: nginx and security headers (F27)

- Move security headers into a shared `include` (e.g. `security-headers.conf`) and `include` it in **every** `location` block, or set them with `always` at the `http`/`server` level via a map — remember location-level `add_header` replaces inherited ones.
- Headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (confirm the edge terminates TLS and that subdomains are all HTTPS before `includeSubDomains`), `Content-Security-Policy` (strict: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` only if inline styles remain — Astro inlines CSS, so either hash them or allow inline styles and document why; `script-src 'self'` plus hashes for the three inline scripts; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Content-Type-Options: nosniff`, remove `X-XSS-Protection`, replace `X-Frame-Options` with CSP `frame-ancestors`.
- Enable Brotli if the nginx image supports it; otherwise pre-compress (`.br`/`.gz`) at build and use `gzip_static`/`brotli_static`. `gzip_min_length` 10240 → 1024.
- Extend `test/server.test.ts` (Docker) to assert every header on `/`, `/projects/`, `/chris-vouga-resume.pdf`, and a static asset.
- Add `/.well-known/security.txt` and `/humans.txt`.
- Add `manifest.webmanifest` + SVG favicon (F28); `theme-color` for both schemes.

### Issue 20: Performance budget in CI

- Lighthouse CI on `/`, `/projects/`, one case study: 100/100/100/100, with budgets: HTML < 100 KB, total transfer < 400 KB on `/`, zero third-party requests, LCP < 1.5 s on simulated mobile, CLS 0 (every `<img>` has `width`/`height`).
- Images: AVIF with WebP fallback via `<picture>`; `loading="lazy"` on everything below the fold; `fetchpriority="high"` on the first project image if it is the LCP element.
- Fonts: both variable fonts are already preloaded and ~90 KB total — keep; add `font-display: swap` check.

### Issue 21: Link and freshness monitoring

- `health-check-urls` runs daily in the Maintenance workflow (not as a PR gate) and opens an issue when any `Live`, `Code`, or receipt link is not 2xx. Every project subdomain (`todo.`, `snake.`, `imageservice.`, `llm-proxy.`, …) is checked; a dead "Live" link is worse than none.
- Add a visible "Last updated {build date}" in the footer, derived at build time.
- Dependency freshness: the Maintenance job already opens snapshot/dependency PRs — verify Astro, Playwright, and Bun are current at the time you work (the lockfile pins Playwright 1.64 while `package.json` says `^1.48` — align).

### Issue 22: Copy quality sweep

- Every work/project bullet starts with a strong past-tense verb (current role: present perfect or past for shipped items), one idea per bullet, ≤ 28 words.
- Consistent terms: "résumé" everywhere (not "resume"/"CV") in UI; "AI coding agents" everywhere (not "AI agents"/"agents"/"LLMs" interchangeably).
- Run a reading-level check (target ≤ grade 10 for hero/about); no jargon a non-engineer recruiter cannot parse in the hero.
- Spell-check all registry strings in a test (dictionary + allowlist of product names).

### Issue 23: Consistency across site, résumé, GitHub, LinkedIn

- Produce `CONSISTENCY_CHECKLIST.md`: the one hero sentence, role titles with month dates, the three flagships, the skills rows — and instruct Chris to mirror them verbatim on LinkedIn (headline, About, Experience, Featured = the three case studies, Open-to-work settings).
- Test: the résumé summary, JSON-LD description, `llms.txt` summary, profile README lead, and OG description are all derived from `HERO.statement` (no second copy anywhere).

### Issue 24: Measurement without trackers

- Keep "no trackers" (it is a brand point). Add **server-side counts only**: nginx access-log aggregation in the Maintenance job (or the edge's analytics if available) for résumé downloads, `/resume.json`, case-study views, and `mailto` clicks (via a same-origin `/go/email` 302 that logs and redirects). Report weekly as a comment on a pinned issue. Document in the footer: "no cookies, no client-side tracking; server logs only."

---

# Part 4 — Mandatory self-audit protocol (run after the backlog, repeat until clean)

1. Build the site with and without `PORTFOLIO_GITHUB_TOKEN`; both must succeed (snapshot fallback).
2. Run the full automated suite: `bun run check`, `bun test src`, `bun run test:docker`, axe, Lighthouse CI, link check, JSON Resume schema validation, PDF extraction test, contrast test.
3. Spawn a **separate reviewer agent** that has not seen your diffs, give it only Part 5 and the deployed/previewed URLs, and have it produce a numbered findings list with severity (blocker / major / minor / nit). It must also view screenshots at 1440×900, 390×844, and 320×568, in dark and light, and print preview.
4. Fix every blocker and major. For each minor/nit, fix or write a one-line justified "won't fix" in `AUDIT_LOG.md`.
5. Repeat steps 1–4 until the reviewer agent reports zero blockers, zero majors, and ≤ 3 minors.
6. Commit `AUDIT_LOG.md` (dated findings, fixes, and won't-fixes) to `packages/portfolio/`. The next person who audits should find that every obvious question already has an answer there.

---

# Part 5 — The auditor's checklist (this is the bar)

The reviewer agent checks every line. "Pass" criteria are explicit so there is no judgment call about whether an item is done.

**A. Story and evidence**

- A1 First screen: a non-engineer can say in one sentence what Chris is uniquely good at. Differentiator is the largest text after the name.
- A2 Every work bullet for the two senior roles has a number, a %, a $, or a link to an artifact. Zero present-tense job-description bullets.
- A3 Role dates have months. Any gap > 2 months is either explained or visibly dated (no year-only smoothing).
- A4 Staff-level scope evidence exists for at least one role (team led / cross-team impact / org-level decision).
- A5 Each "How I build" principle links to a concrete repo artifact that resolves. One end-to-end example with PR + failing run + fix links exists. One candid failure paragraph exists.
- A6 Named tooling line exists (Claude Code / Codex / Cursor / MCP as true).
- A7 Proof section leads with verification metrics (gates, tests, pass rate, PRs caught by CI). Bot activity is excluded and the exclusion is stated. No "public repos" tile. Any anomalous day is footnoted.
- A8 Exactly three flagship projects on the homepage; each has Code or a case study; each case study follows the standard format and includes "how correctness is enforced" and "what I'd do differently."
- A9 No toy/tutorial project appears outside a collapsed archive. No employer product is listed as a personal project.
- A10 Writing section exists with ≥ 2 published posts (not drafts) and RSS.
- A11 Social proof block has ≥ 2 attributed quotes with links, or is absent entirely (never placeholder).
- A12 Logistics line present: authorization, time zone, remote preference, earliest start, response time.
- A13 Zero `{{NEEDS_INPUT}}` strings in the built output (test-enforced).
- A14 Site, résumé, `/resume.json`, `/llms.txt`, JSON-LD, GitHub profile README, and LinkedIn (checklist) tell the same story with identical role titles and dates.

**B. Résumé PDF**

- B1 One page; text layer; headings extract as single words; bullets extract as single lines; links clickable; `/Author`, `/Subject`, `/Keywords` set.
- B2 AI-assisted engineering row and infra row present; Go/Rust/Docker/OpenTofu/NixOS/GitHub Actions/Playwright present where true.
- B3 Three projects with outcomes. Month dates. Quantified bullets.
- B4 Phone absent from the public URL unless the flag is on. `Cache-Control: no-cache`.

**C. GitHub**

- C1 Profile has bio, README, six pins in the specified order. Every pinned repo: README with run-in-60s, screenshot/GIF, green CI badge, license, `SECURITY.md`. Mockingbird: < 10 open issues untriaged, 0 stale PRs. Dead repos archived.

**D. Accessibility**

- D1 axe: zero violations on all pages. D2 Every text/background pair ≥ 4.5:1 (test). D3 No ambiguous repeated link text; all images have specific alt or are provably decorative. D4 Heading outline is logical (h1 → h2 sections → h3 items). D5 Keyboard: every control reachable, dialog traps and restores focus, period picker operable. D6 Reduced motion honored. D7 Tap targets ≥ 44 px.

**E. Visual and responsive**

- E1 No duplicate CTAs visible at once on any viewport. E2 320 / 390 / 1440 px: no horizontal page scroll, no overflow, no clipped text. E3 Light theme and print preview both legible; OG card correct in Slack/LinkedIn/X previews. E4 Mobile page height within target.

**F. Performance**

- F1 Lighthouse 100/100/100/100 on `/`, `/projects/`, a case study. F2 HTML < 100 KB; zero third-party requests; CLS 0; every image has dimensions; AVIF/WebP. F3 Fonts preloaded, `font-display` set.

**G. Security and infra**

- G1 All security headers present on every route including static assets and the PDF (Docker test). CSP has no `unsafe-eval`; inline scripts hashed or eliminated. HSTS present. No deprecated headers. G2 Brotli or pre-compressed assets. G3 `security.txt`, `manifest.webmanifest`, SVG favicon, RSS, sitemap, robots present and valid. G4 404 is a real 404 with useful links.

**H. Freshness and hygiene**

- H1 Footer shows build date; snapshot-age caption present when GitHub data is cached. H2 Daily link check in Maintenance; zero dead "Live"/"Code"/receipt links today. H3 Dependencies current; lockfile and manifest ranges agree. H4 `AUDIT_LOG.md` exists with dated entries and justified won't-fixes. H5 No TODO/FIXME/console.log in shipped source; no unused assets (`assets:prune` clean).

**I. Copy**

- I1 Spell-check test green. I2 Terminology consistent (résumé; AI coding agents). I3 Every bullet ≤ 28 words, one idea, strong verb. I4 Nothing generic: for each sentence in hero/about/how-I-build, the auditor asks "could any engineer have written this?" — if yes, it is a finding.

---

# Part 6 — Seed for `CONTENT_QUESTIONS.md` (Chris answers; one line each)

**Geviti (Jan 2026 – present)**

1. Member count or order of magnitude the features you shipped serve.
2. Three shipped things since joining, each with a measurable effect (adoption, latency, error rate, support tickets, time saved).
3. Team size and who you coordinate with (clinical, product, mobile).
4. Anything you own end to end (a service, a pipeline, the mobile app).

**One Origin (2022 – 2025)** 5. Triangulator: number of institutions, evaluations processed, staff hours or days saved, accuracy/acceptance rate of ranked suggestions; team size you led; your decisions. 6. Orchard LMS integration: number of courses/students, grade-sync volume, failure-path incident count. 7. ASU Earned Admissions: learner volume, sync volume, what the opt-in flow changed. 8. Study Hall payments: failed-payment rate before → after; transaction volume. 9. Sun Devils: traffic or usage numbers. 10. Award citation text for each quarterly recognition. 11. Exact start/end months.

**Gap and current status** 12. What were you doing between leaving One Origin and starting Geviti (one honest line; e.g. "built Mockingbird full-time")? 13. Are you actively looking or open to conversations? (The site says "open to senior and staff roles" while 10 months into a senior role — decide how to phrase so a current employer and a recruiter both read it correctly.)

**Logistics** 14. Work authorization (e.g. US citizen; no sponsorship needed). 15. Time zone and remote/hybrid preference; any cities. 16. Earliest start / notice period. 17. Typical reply time. 18. Team/stage/domain you want next (one line). 19. Scheduling link, if any. 20. Will you set up `chris@chrisvouga.dev` forwarding?

**Proof** 21. Reason for the Sep–Oct 2026 contribution spike and the 1,587-commit day (migration? bulk import? bot?). 22. Is the gamezilla source public? 23. Which agent tools do you actually use day to day (Claude Code, Codex, Cursor, others)? 24. One time an agent mistake reached production (or nearly did) and what you changed. 25. Two or three people who would give a one-line quote (name, title, link). 26. Any external OSS contributions, talks, podcasts, or community work.

**Résumé** 27. Keep the phone number on the public PDF? 28. Any certifications or security clearances.

---

# Definition of done for the whole backlog

- All issues merged; all Part 6 questions answered and placeholders resolved; Part 4 protocol run to a clean result; `AUDIT_LOG.md` committed.
- A fresh auditor using Part 5 reports zero blockers, zero majors, ≤ 3 minors.
