# Content questions for Chris

The portfolio never states a fact that is not derivable from a repository or already written by Chris. Where a fact is missing, the registry field is **optional and unrendered** instead of padded with a guess, and the question lands here. Answer a line, put the answer in the named registry field, and the site, résumé, `/resume.json`, `/llms.txt` and JSON-LD all pick it up on the next build.

`{{NEEDS_INPUT: …}}` is the marker for a fact that must be filled before deploy. `src/content/needs-input.test.ts` fails the build while one remains in `src/content/**` or `dist/`. Use it only when a draft must not ship half-finished; an optional field that stays unset is the normal state for an unanswered question.

Status key: **open**, **derived** (answered from repository evidence; confirm), **answered**.

## Geviti (Jan 2026 – present) — `src/content/work.ts`

1. **open** — Member count, or order of magnitude, that the features you shipped serve. → `WORK[0].highlights`
2. **open** — Three things shipped since joining, each with a measurable effect (adoption, latency, error rate, support tickets, time saved). → `WORK[0].highlights`. Until then the bullets name what shipped and link the member app; none claims a number.
3. **open** — Team size, and who you coordinate with (clinical, product, mobile). → `WORK[0].highlights` or `WORK[0].scope`
4. **open** — Anything you own end to end (a service, a pipeline, the mobile app). → `WORK[0].highlights`
5. **derived** — Start month. The role was added to this portfolio on 2026-01-02 (`git show 5b7b5ad0`), so `start: { year: 2026, month: 1 }`. Confirm.

## One Origin (2022 – 2025) — `src/content/work.ts`

6. **open** — Triangulator: institutions using it, evaluations processed, staff hours or days saved, acceptance rate of ranked suggestions, team size you led, decisions you owned. → `WORK[1].highlights` and the Triangulator case study (`src/content/case-studies/`). The homepage flagship trio uses Triangulator only once its case study exists (every homepage project needs code or a case study).
7. **open** — Orchard LMS integration: courses or students, grade-sync volume, failure-path incident count.
8. **open** — ASU Earned Admissions: learner volume, sync volume, what the opt-in flow changed.
9. **open** — Study Hall payments: failed-payment rate before → after; transaction volume. The current bullet says the rebuild cut failed payments; a number would make it evidence.
10. **open** — Sun Devils: traffic or usage numbers.
11. **open** — Award citation text for each quarterly recognition (the certificates are images only). → `WORK[1].awards`
12. **open** — Exact start and end months for One Origin and Freelancing. → `start.month` / `end.month`. Year-only ranges render as years; nothing is smoothed.

## Gap and current status — `src/content/work.ts`, `src/content/hero.ts`

13. **open** — Between leaving One Origin and starting Geviti (one honest line, e.g. "built Mockingbird full-time"). → `WORK_GAP_NOTE`. Not rendered until set; the months stay visible either way.
14. **answered (2026-10-26)** — "Open to conversations about staff roles": selective interest while employed. → `HERO.availability`

## Logistics — `src/content/hero.ts` (`LOGISTICS`)

15. **answered (2026-10-26)** — US citizen, no sponsorship needed. → `LOGISTICS.authorization`
16. **derived** — Time zone: Phoenix does not observe daylight saving, so the site shows `UTC−7 (Arizona)`. Confirm, and add any cities you would relocate to. → `LOGISTICS.timeZone`
17. **open** — Remote/hybrid preference beyond "open to remote". → `LOCATION_PREFERENCE`
18. **answered (2026-10-26)** — Left off by choice; no start line renders. → `LOGISTICS.start` stays unset
19. **open** — Typical reply time. → `LOGISTICS.replyTime`
20. **open** — Team, stage and domain you want next (one line). → `CONTACT_COPY.lookingFor`
21. **open** — Scheduling link, if any. → `CONTENT.SCHEDULING_URL`
22. **open** — Will you set up `chris@chrisvouga.dev` forwarding? If yes, change `CONTENT.EMAIL_ADDRESS`; every surface derives from it.

## Proof — `src/content/agentic.ts`, `src/content/proof.ts`

23. **derived** — The Sep–Oct 2026 spike and the 2026-10-15 peak (1,587). GitHub's `restrictedContributionsCount` puts 82% of the trailing twelve months' contributions (84% of Sep–Oct) in private repositories, mostly employer work. The proof section states the twelve-month share, derived at build time; add the reason in your own words if you want one. → `PROOF_ANOMALY_NOTE`
24. **answered (private)** — gamezilla source is private (`crvouga/gamezilla`); it is a homepage flagship through its case study, and the card says the source is private. Its figures come from `src/data/gamezilla-facts.json`, which the daily job cannot refresh (its token cannot read a private repository): run `GITHUB_TOKEN=$(gh auth token) bun run gamezilla-facts` now and then; the page prints the date.
    24a. **open — time-sensitive** — gamezilla's own CI is red as of 2026-10-26 (Verify PR, Deploy, Health and Verify Nightly all failing). The case study claims nothing about its CI, but it argues that a green pull request is releasable; get it green before pointing a reviewer at it.
25. **derived** — Agent tools: Claude Code and Cursor are the co-authors in this repository's commit trailers; `scripts/agent-commands.ts` syncs the same commands to Codex, OpenCode and Windsurf. The tooling line says exactly that. Correct it if you use something else daily.
26. **derived — please verify** — A time the method failed: PR #100 (agent co-authored) added direct Railway API calls to a deploy workflow, against the OpenTofu-only rule. A path filter skipped the `check` job, so the policy test that forbids it did not run, and it merged. The next PR's check caught it and `acc261f4` removed the calls; PR #120 later removed the path filter. `AGENTIC_CANDOR` tells this story. Confirm it, or replace it with the incident you would rather tell.
27. **open** — Two or three people who would give a one-line quote (name, title, public link). → `src/content/testimonials.ts`. The block does not render until two are filled.
28. **open** — External open-source contributions, talks, podcasts or community work. → `COMMUNITY` in `src/content/testimonials.ts`. Omitted while empty.
    29b. **open — time-sensitive** — Mockingbird PR #559 ("patch vulnerable dependencies", by outside contributor `crsiebler`, opened 2026-10-22) has no response. A security PR left unanswered on a flagship is the first thing a reviewer of the repository sees; review it, then merge or close it with a reply.

## Résumé — `src/resume/`

29. **answered (default off)** — Phone number on the public PDF. It is now behind `RESUME_INCLUDE_PHONE=1`; the public build omits it. Build the full copy for a direct application with `RESUME_INCLUDE_PHONE=1 bun run build`.
30. **open** — Certifications or security clearances.

## Writing — `src/content/writing/`

31. **open** — Three drafts are written from repository artifacts and marked `draft: true`; each lists the claims to check under `verify:` and carries `[[VERIFY: …]]` markers in its body. Publishing one means: fix every marker, delete the `verify:` entries you have checked, and set `draft: false`. A test refuses to publish a post that still has a marker. The Writing nav link and RSS appear with the first published post.

## GitHub profile and repositories (you apply these; nothing here mutates GitHub)

32. **open** — Create `crvouga/crvouga` and commit `generated/github-profile-README.md` as its `README.md` (`bun run gen:profile-readme` regenerates it).
33. **open** — Bio: the hero line plus your availability line.
34. **open** — Six pins, in order: `mockingbird`, `workspace`, `llm-server`, `violets-garden`, `moviefinder.app-rust`, `imageresizerservice.com` (swap any for your pick). gamezilla is private, so it cannot be pinned; headless-combobox stays listed on the site but is not featured or pinned. `crvouga/crvouga` currently redirects to the archived `crvouga/portfolio`; rename or recreate it so the profile README shows.
35. **open** — Repository hygiene (`bun run refresh-verification` reports the state): **no pinned repository has a LICENSE file** (GitHub reports `license: null` for mockingbird, headless-combobox and workspace; Mockingbird's README says MIT and headless-combobox's package.json says ISC), and none has a `SECURITY.md`. Add both. headless-combobox, llm-server and violets-garden have no CI badge; llm-server, workspace and violets-garden have no screenshot in the README. violets-garden's solvability test does not run in its CI.
36. **open** — Mockingbird's scheduled Junction sandbox check (`verify.yml`) has failed daily since 2026-10-06 with HTTP 402 from the sandbox. Every service's parity tier is `cold`, so the weekly live-parity run tests nothing. Restore the sandbox account, or mark the job as paused, before the case study's claims are read against the Actions tab.
37. **open** — Archive dead public repositories so the profile is a curated set.

## Other repositories

39. **open** — Any repository whose `AGENTS.md` / `CLAUDE.md` links `https://www.chrisvouga.dev/llms.txt` for the shared-infrastructure guide should link `https://www.chrisvouga.dev/llms-infra.txt` instead. The old URL now serves candidate information, with a pointer to the infra guide, so agents still find it in one hop.

## LinkedIn

38. **open** — Mirror `CONSISTENCY_CHECKLIST.md` verbatim: headline, About, Experience titles and month dates, Featured = the case studies, Open-to-work settings.

## Raised by the round-4 audit

40. **open** — The "Recognized by Cursor" badge was removed: its only public evidence is your own Short (tagged #vibecoding), which cannot be cited as Cursor's statement. If Cursor posted about it, send the link and it comes back with that receipt.
41. **open** — Retitle the Triangulator YouTube video (currently "triangulator e2e tests complete low quality"); it is the link on the One Origin bullet.
42. **open** — Retitle the open portfolio PR before merging (e.g. "feat(portfolio): case studies, verification metrics, résumé generator"); the current title stays in `main`'s history.
