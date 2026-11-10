---
name: portfolio-refresh
description: Refresh the portfolio's market research, roles and tailored presentations after the job market or the knowledge base changes.
---

<!-- Canonical file; harness copies are symlinks (`bun run agents:sync`). -->

# Portfolio refresh

Everything the portfolio shows is a function of two knowledge bases in
`packages/portfolio`. Scripts own the measured data and everything derived;
you own only what a script cannot produce.

| Layer                                 | Where                                               | Who changes it                                             |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Personal knowledge base (facts)       | `src/knowledge/` (`index.ts` is the façade)         | Chris, or you from facts he states or a repository proves. |
| Market KB, measured (landscape)       | `src/data/market/landscape.json`                    | `bun run market:refresh` only. Never edit by hand.         |
| Market KB, researched (cited sources) | `src/market/research/<id>.json`, `market.json`      | You, from web research, in step 3. Every claim cites.      |
| Roles (segment + voice)               | `src/roles/by-id/<id>.ts`, one file each            | You, in this command.                                      |
| Generated indexes and story exports   | `by-id/index.ts`, `research/index.ts`, story blocks | `bun run roles:sync`. Never by hand.                       |
| Themes, ranking, pages, résumés, gaps | `src/roles/*`, `src/analysis/gaps.ts`, `src/pages`  | Derived at build time. Nothing to do.                      |

A theme is derived from the market research's `visual` section (hue, saturation,
typefaces, corners) and solved for WCAG AA; a résumé takes its section order
from the research and its headings from the voice. `/roles/<id>/` shows each
role's market research; `/gaps/` (unlisted) grades every hiring criterion against the facts.

Run everything from `packages/portfolio`.

## 1. Refresh the measured data (no model tokens)

```sh
bun run market:refresh        # ~1 min: public job-board APIs → landscape.json
bun run roles:status     # the digest: read this, not the raw inputs
```

`market:refresh --offline` re-aggregates the cached postings, which is what
you want after editing the taxonomy or the knowledge base. If the refresh
fails with too few postings, report which sources failed and stop; do not
hand-edit the landscape. The landscape also holds job-family segments
(`jobFamilySegments`) and the distinctive phrases each segment's employers use.

Ranking, section content, résumé bullets, competencies and skill order already
follow the new data on the next build. **If `roles:status` ends with
"Nothing needs attention", skip to step 5.** Most refreshes end here.

## 2. Act only on what the status lists

Work through `Needs attention`, and nothing else. Do not reread or rewrite
voices the report does not name.

- **`voice <id> leans on <themes>…`** — that role's postings moved. Read
  its `asks for` line, its market research's `vocabulary` and its role file, rewrite
  the statement, secondary line and titles so they answer the top themes in
  the research's preferred words, and set `basedOn` to the themes you wrote for.
- **`default is X but Y now has the highest opportunity`** — change
  `DEFAULT_ROLE_ID` (`src/roles/definitions.ts`) only if Y leads by a
  clear margin and is at a level Chris holds; otherwise say why you kept it.
  The default's voice is the copy every feed uses (`/resume.json`,
  `/llms.txt`, JSON-LD, the LinkedIn checklist).
- **`segment <context/level> has no role`** — add one (step 4). Remove a
  role only when its postings fall under the test's minimum, and say so:
  its id is a public URL (`/a/<id>/`).
- **`market research <id> is over … days old`** — redo step 3 for it.
- **`no fact is tagged <theme>`** / skill gaps — the market asks for something
  the knowledge base cannot back. Tag an existing fact if it genuinely is
  evidence. Otherwise add the question to `CONTENT_QUESTIONS.md` and tell
  Chris. Never invent a fact, a metric or a skill to close a gap.

## 3. Research a role

One research file per role: who reads the presentation and what they scan for,
red flags, the words that land and the words to avoid, résumé conventions, and
the look that fits the reader. The zod schema in `src/market/schema.ts` is the
contract; run several research subagents in parallel, one per role, each
told to cite only sources it read (2025 onward where possible), to quote no
number its source does not state, and to use only theme ids from
`src/knowledge/themes.ts` and skill ids from `src/roles/skills.ts`.
Set `asOf`. The build parses every research file and rejects a dangling citation.

When two roles' research lands on the same style, keep the research and set the role
file's `style` (with a one-line reason) so the presentations stay distinct.

## 4. Add a role

```sh
bun run roles:new <id> --label=<Word> --context=<startup|tech|corporate|contract> --levels=mid,senior
bun run roles:new <id> --label=<Word> --family=<ai-product|platform|fullstack|architect> --levels=mid,senior,staff
```

This writes `src/roles/by-id/<id>.ts` and an empty research file. Fill it
(step 3), write the voice from it, then `bun run roles:sync`, which
regenerates the indexes, the role's details story and every story file's
variants. Nothing else is edited by hand: the theme, page, résumé, Storybook
variants and gap analysis all follow.

## 5. Rules for anything you write

- A voice restates facts already in `src/knowledge/`; it adds none. No typed
  numbers, years or technology names; "AI coding agents", never "AI agents";
  none of its market research's `avoid` words. `src/roles/roles.test.ts`
  enforces this.
- Knowledge-base text is plain, with `[label](url)` and `**strong**` only. No
  HTML, no image paths. Give each new fact at most five themes.
- A theme changes palette and typography, never structure.
- New taxonomy (a skill or theme the postings name and the vocabulary lacks)
  goes in `src/roles/skills.ts` or `src/knowledge/themes.ts` +
  `scripts/market/taxonomy.ts`, followed by `bun run market:refresh --offline`.

## 6. Verify and report

```sh
bun run roles:sync       # generated files current
bun run gen:profile-readme    # regenerates the README and LinkedIn checklist
bun run facts                 # platform facts count the tests you may have added
bun run test && bun run tc && bun run lint
bun run build                 # renders every page and every résumé PDF
bun run test:site             # axe, layout and budgets for every presentation
```

The build prints `[resume:<id>] trimmed to fit one page` when a role's
résumé dropped its lowest-ranked bullet; report it, and shorten that voice if
the trim removes something its audience asks for.

Report in this order: what the market data changed (sample size, which
role's demand moved), what the research changed, what you rewrote and
why, the readiness and top moves from `/gaps/`, the open questions for Chris,
and the check results. Then use `/pr-ready` if asked to ship.

## Schedule

Maintenance refreshes the landscape weekly without a model
(`market:refresh --max-age-days=7`) and lands it through the snapshot bot PR,
so rankings stay current on their own. Run this command when that PR changes
`landscape.json` noticeably, when a role's market research goes stale, when Chris adds
to the knowledge base, or when he asks for a new role.
