/**
 * Pure classifiers shared by `platform-facts.ts` and `refresh-verification.ts`.
 * No I/O lives here, so every rule that decides a published number is unit
 * tested in `src/lib/verification.test.ts`.
 */

import type { AiTool } from '../../src/lib/platform-facts';

/**
 * Head branches opened by scheduled automation. These PRs are authored as
 * `crvouga` through a PAT (`DEPLOY_DISPATCH_TOKEN`), so the author cannot tell
 * them apart from human work; the branch can. Sources, in maintenance.yml:
 *   - `REFRESH_BRANCH` in the `update` job's snapshot task;
 *   - `branch=` in its "Update Nix dependencies" step.
 * ci.yml opens no PRs. A test asserts every branch maintenance.yml assigns is
 * listed here, so a new scheduled PR cannot silently inflate the human count.
 */
export const AUTOMATION_BRANCHES: readonly string[] = [
  'chore/github-insights-refresh',
  'chore/fleet-flake-lock',
];

export type PrAuthorship = {
  readonly authorLogin: string | null;
  /** GraphQL `__typename === 'Bot'`; REST logins end in `[bot]` instead. */
  readonly authorIsBot: boolean;
  readonly headRefName: string;
};

export const isAutomatedPr = (pr: PrAuthorship): boolean =>
  pr.authorIsBot ||
  (pr.authorLogin ?? '').endsWith('[bot]') ||
  AUTOMATION_BRANCHES.includes(pr.headRefName);

/**
 * A `Co-Authored-By:` trailer line (any capitalisation) naming Claude — any
 * model, e.g. "Claude Opus 5" — or Cursor. Captures the tool word.
 */
const AI_TRAILER = /^co-authored-by:[ \t]*(claude|cursor)\b/gim;

const toolOf = (word: string): AiTool =>
  word.toLowerCase() === 'cursor' ? 'Cursor' : 'Claude Code';

/** One entry per matching trailer line, in message order. */
export const aiTrailersIn = (message: string): readonly AiTool[] =>
  [...message.matchAll(AI_TRAILER)].map((match) => toolOf(match[1] ?? ''));

export const hasAiTrailer = (message: string): boolean =>
  aiTrailersIn(message).length > 0;

/** Test files counted for call sites: `*.test.ts`, `*.test.tsx`, `*.spec.ts`. */
export const isTestFile = (path: string): boolean =>
  /\.(?:test\.tsx?|spec\.ts)$/.test(path) &&
  !path.split('/').includes('node_modules');

/**
 * `test(` / `it(` call sites, optionally through Bun/Vitest/Jest modifiers
 * (`test.each(`, `it.skip.each(`, `test.if(cond)(`…). Counted once per
 * occurrence; the `.each` table's expansion is not multiplied out.
 *
 * The callee must start a line or follow whitespace, `;`, `{` or `}`. That
 * rejects identifiers that merely end in the letters (`submit(`, `split(`,
 * `wait(`, `commit(`) and member calls (`/re/.test(s)`, `pattern.test(s)`),
 * and requires the `(` immediately, so prose such as "count it (once)" in a
 * comment does not match. A call inside a string literal still matches when
 * the quote is not adjacent; test files rarely contain one.
 */
const MODIFIERS =
  'each|only|skip|todo|if|skipIf|runIf|todoIf|concurrent|failing|serial';
const CALL_SITE = new RegExp(
  `(?<=^|[\\s;{}])(?:test|it)(?:\\.(?:${MODIFIERS}))*\\(`,
  'gm'
);

export const countTestCallSites = (source: string): number =>
  source.match(CALL_SITE)?.length ?? 0;
