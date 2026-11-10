---
name: portfolio-refresh
description: Refresh the portfolio's market research, archetypes and tailored presentations after the job market or the knowledge base changes.
---

<!-- Canonical file; harness copies are symlinks (`bun run agents:sync`). -->

# Portfolio refresh

The portfolio is three layers in `packages/portfolio`. Scripts own the first
and the last; you own only what a script cannot derive.

| Layer                           | Where                                                                | Who changes it                                             |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| Market landscape                | `src/data/market/landscape.json`                                     | `bun run market:refresh` only. Never edit by hand.         |
| Knowledge base (facts)          | `src/knowledge/`                                                     | Chris, or you from facts he states or a repository proves. |
| Archetypes, voices, themes      | `src/archetypes/{definitions,voice,theme}.ts`                        | You, in this command.                                      |
| Ranking, pages, résumés, routes | `src/archetypes/{rank,presentation}.ts`, `src/pages/a/[archetype]/…` | Derived at build time. Nothing to do.                      |

Run everything from `packages/portfolio`.

## 1. Refresh the data (no model tokens)

```sh
bun run market:refresh        # ~1 min: public job-board APIs → landscape.json
bun run archetypes:status     # the digest: read this, not the raw inputs
```

`market:refresh --offline` re-aggregates the cached postings, which is what
you want after editing the taxonomy or the knowledge base. If the refresh
fails with too few postings, report which sources failed and stop; do not
hand-edit the landscape.

Ranking, section content, résumé bullets and skill order already follow the
new data on the next build. **If `archetypes:status` ends with "Nothing needs
attention", skip to step 4.** Most refreshes end here.

## 2. Act only on what the status lists

Work through `Needs attention`, and nothing else. Do not reread or rewrite
voices the report does not name.

- **`voice <id> leans on <themes>…`** — that archetype's postings moved. Read
  its `asks for` line and its entry in `src/archetypes/voice.ts`, rewrite the
  statement, secondary line and titles so they answer the top themes, and set
  `basedOn` to the themes you wrote for.
- **`default is X but Y now has the highest opportunity`** — change
  `DEFAULT_ARCHETYPE_ID` only if Y leads by a clear margin and is at a level
  Chris holds; otherwise say why you kept it. The default's voice is the copy
  every feed uses (`/resume.json`, `/llms.txt`, JSON-LD, the LinkedIn checklist).
- **`segment <context/level> has no archetype`** — add an entry to
  `ARCHETYPES` (id shaped `<context>-<company>-<level>-<role>`), then a voice
  and a theme for it; TypeScript will not compile until all three exist.
  Remove an archetype only when its postings fall under the test's minimum,
  and say so: its id is a public URL (`/?archetype=<id>`).
- **`no fact is tagged <theme>`** / skill gaps — the market asks for something
  the knowledge base cannot back. Tag an existing fact if it genuinely is
  evidence. Otherwise add the question to `CONTENT_QUESTIONS.md` and tell
  Chris. Never invent a fact, a metric or a skill to close a gap.

## 3. Rules for anything you write

- A voice restates facts already in `src/knowledge/`; it adds none. No typed
  numbers, years or technology names; "AI coding agents", never "AI agents".
  `src/archetypes/archetypes.test.ts` enforces this.
- Knowledge-base text is plain, with `[label](url)` and `**strong**` only. No
  HTML, no image paths. Give each new fact at most five themes.
- A theme changes palette and typography, never structure. New colours must
  pass the contrast test.
- New taxonomy (a skill or theme the postings name and the vocabulary lacks)
  goes in `src/archetypes/skills.ts` or `src/knowledge/themes.ts` +
  `scripts/market/taxonomy.ts`, followed by `bun run market:refresh --offline`.

## 4. Verify and report

```sh
bun run gen:profile-readme    # regenerates the README and LinkedIn checklist
bun run facts                 # platform facts count the tests you may have added
bun run test && bun run tc && bun run lint
bun run build                 # renders every page and every résumé PDF
bun run test:site             # axe, layout and budgets for every presentation
```

The build prints `[resume:<id>] trimmed to fit one page` when an archetype's
résumé dropped its lowest-ranked bullet; report it, and shorten that voice if
the trim removes something its audience asks for.

Report in this order: what the market data changed (sample size, which
archetype's demand moved), what you rewrote and why, the open questions for
Chris, and the check results. Then use `/pr-ready` if asked to ship.

## Schedule

Maintenance refreshes the landscape weekly without a model
(`market:refresh --max-age-days=7`) and lands it through the snapshot bot PR,
so rankings stay current on their own. Run this command when that PR changes
`landscape.json` noticeably, when Chris adds to the knowledge base, or when he
asks for a new archetype.
