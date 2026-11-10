/**
 * Required `protected-paths` check. Nobody reads agent code, so a PR fails here
 * unless it carries `needs-human` when it:
 *   - touches CI, infrastructure, agent instructions, lint/type/test config or
 *     check scripts (or bun.lock / root package.json without `deps`);
 *   - adds a test skip, `.only`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`
 *     or `@ts-nocheck`;
 *   - deletes a test file.
 * `do-not-merge` and `pull_request_target` always fail.
 *
 *   BASE_SHA HEAD_SHA LABELS='["a"]' AUTHOR=login bun scripts/ci/protected-paths.ts
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Change = { status: string; path: string };
export type Line = { path: string; line: number; text: string; added: boolean };
export type Violation = {
  rule: string;
  path: string;
  line?: number;
  detail: string;
  waivable: boolean;
};
export type Input = {
  changes: Change[];
  lines: Line[];
  labels: string[];
  author: string;
};

const PROTECTED: [RegExp, string][] = [
  [/^\.github\//, 'CI and repository automation'],
  [/^packages\/infra\/tofu\//, 'OpenTofu infrastructure'],
  [/(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/, 'agent instructions'],
  [
    /(^|\/)eslint\.config\.[cm]?[jt]s$|(^|\/)\.eslintrc|^packages\/eslint-rules\//,
    'lint config',
  ],
  [/(^|\/)tsconfig[^/]*\.json$/, 'type config'],
  [
    /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$|(^|\/)bunfig\.toml$/,
    'test config',
  ],
  [
    /(^|\/)turbo\.json$|^\.prettier(rc|ignore)|^commitlint\.config\.js$|^\.gitleaks\.toml$|^\.editorconfig$/,
    'check config',
  ],
  [/^scripts\/ci\/protected-paths/, 'this guardrail'],
];
const DEPENDENCY_FILES = /^(bun\.lock|package\.json)$/;
const CODE = /\.([cm]?[jt]sx?|py|astro|svelte|vue)$/;
const SELF = /^scripts\/ci\/protected-paths/;
const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$|\.tftest\.hcl$|_test\.py$|(^|\/)test_[^/]*\.py$|(^|\/)(tests?|__tests__)\/)/;
const CHECK_SCRIPT = /^\s*"(test|lint|tc|typecheck|check)(:[^"]*)?"\s*:/;
const WEAKENERS: [RegExp, string][] = [
  [
    /\b(describe|it|test|suite|context)\.only\b/,
    '`.only` focuses a subset of tests',
  ],
  [
    /\b(describe|it|test|suite)\.(skip|skipIf|todo|failing)\b|\bx(it|describe|test)\s*\(/,
    'test skip',
  ],
  [/@pytest\.mark\.skip|@unittest\.skip|\bpytest\.skip\(/, 'test skip'],
  [/eslint-disable/, '`eslint-disable`'],
  [/@ts-(ignore|expect-error|nocheck)\b/, 'TypeScript suppression'],
];

/** A Dependabot Actions bump only rewrites `uses:` pins (and their comments). */
function onlyActionPins(lines: Line[], path: string): boolean {
  const changed = lines.filter((l) => l.path === path);
  return (
    changed.length > 0 &&
    changed.every((l) => /^\s*(-\s+)?uses:\s|^\s*#/.test(l.text))
  );
}

export function evaluate(input: Input): Violation[] {
  const labels = new Set(input.labels);
  const deps = labels.has('deps');
  const dependabot = input.author === 'dependabot[bot]' && deps;
  const violations: Violation[] = [];

  if (labels.has('do-not-merge'))
    violations.push({
      rule: 'do-not-merge',
      path: '-',
      detail: 'PR is labeled `do-not-merge`',
      waivable: false,
    });

  for (const change of input.changes) {
    if (change.status.startsWith('D') && TEST_FILE.test(change.path))
      violations.push({
        rule: 'deleted-test',
        path: change.path,
        detail: 'deletes a test file',
        waivable: true,
      });
    if (DEPENDENCY_FILES.test(change.path) && !deps)
      violations.push({
        rule: 'dependencies',
        path: change.path,
        detail:
          'changes root dependencies without the `deps` label (the update bot owns bumps)',
        waivable: true,
      });
    const area = PROTECTED.find(([pattern]) => pattern.test(change.path));
    if (!area) continue;
    if (
      dependabot &&
      change.path.startsWith('.github/') &&
      onlyActionPins(input.lines, change.path)
    )
      continue;
    violations.push({
      rule: 'protected-path',
      path: change.path,
      detail: `touches ${area[1]}`,
      waivable: true,
    });
  }

  for (const line of input.lines) {
    // Changing or removing an existing check script; adding new ones is fine.
    if (
      !line.added &&
      /(^|\/)package\.json$/.test(line.path) &&
      CHECK_SCRIPT.test(line.text) &&
      !dependabot
    )
      violations.push({
        rule: 'check-script',
        path: line.path,
        line: line.line,
        detail: 'changes or removes a check script',
        waivable: true,
      });
    if (!line.added) continue;
    if (
      /^\.github\/workflows\//.test(line.path) &&
      /\bpull_request_target\b/.test(line.text)
    )
      violations.push({
        rule: 'pull-request-target',
        path: line.path,
        line: line.line,
        detail: '`pull_request_target` is not allowed',
        waivable: false,
      });
    if (!CODE.test(line.path) || SELF.test(line.path)) continue;
    for (const [pattern, detail] of WEAKENERS)
      if (pattern.test(line.text)) {
        violations.push({
          rule: 'weakened-check',
          path: line.path,
          line: line.line,
          detail: `adds ${detail}`,
          waivable: true,
        });
        break;
      }
  }
  return violations;
}

export function blocking(
  violations: Violation[],
  labels: string[]
): Violation[] {
  const waived = labels.includes('needs-human');
  return violations.filter((v) => !v.waivable || !waived);
}

/** Parses `git diff -U0` into added and removed lines with their line numbers. */
export function parseDiff(diff: string): Line[] {
  const lines: Line[] = [];
  let path = '';
  let added = 0;
  let removed = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      if (raw !== '+++ /dev/null') path = raw.slice(6);
      continue;
    }
    if (raw.startsWith('--- ')) {
      path = raw === '--- /dev/null' ? '' : raw.slice(6);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      removed = Number(hunk[1]);
      added = Number(hunk[2]);
      continue;
    }
    if (!path) continue;
    if (raw.startsWith('+'))
      lines.push({ path, line: added++, text: raw.slice(1), added: true });
    else if (raw.startsWith('-'))
      lines.push({ path, line: removed++, text: raw.slice(1), added: false });
  }
  return lines;
}

export function parseNameStatus(output: string): Change[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const parts = row.split('\t');
      return { status: parts[0], path: parts.at(-1)! };
    });
}

export function report(
  violations: Violation[],
  failing: Violation[],
  labels: string[]
): string {
  if (!violations.length)
    return '### ✅ protected-paths\n\nNo protected paths or weakened checks.\n';
  const rows = violations.map(
    (v) =>
      `| ${failing.includes(v) ? '❌' : '⚠️ waived'} | \`${v.path}${v.line ? `:${v.line}` : ''}\` | ${v.detail} |`
  );
  const verdict = failing.length
    ? failing.every((v) => v.waivable)
      ? 'Fix the change, or add the `needs-human` label and explain why in the PR body. `needs-human` turns off auto-merge; a human merges it.'
      : 'These cannot be waived. Remove them (or the `do-not-merge` label).'
    : `Waived by \`needs-human\` (labels: ${labels.join(', ')}). A human merges this PR.`;
  return [
    `### ${failing.length ? '❌' : '⚠️'} protected-paths`,
    '',
    '| | Where | Why |',
    '|---|---|---|',
    ...rows,
    '',
    verdict,
    '',
  ].join('\n');
}

function git(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.toString();
}

if (import.meta.main) {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA ?? 'HEAD';
  if (!base) throw new Error('BASE_SHA is required');
  const labels: string[] = JSON.parse(process.env.LABELS || '[]');
  const range = `${base}...${head}`;
  const input: Input = {
    changes: parseNameStatus(git(['diff', '--name-status', '-M', range])),
    lines: parseDiff(git(['diff', '-U0', '-M', '--no-color', range])),
    labels,
    author: process.env.AUTHOR ?? '',
  };
  const violations = evaluate(input);
  const failing = blocking(violations, labels);
  const markdown = report(violations, failing, labels);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (failing.length) {
    const directory = join(process.env.RUNNER_TEMP ?? '/tmp', 'ci-summary');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'summary.json'),
      JSON.stringify({
        job: 'protected-paths',
        command: `BASE_SHA=$(git merge-base origin/main HEAD) LABELS='${JSON.stringify(labels)}' bun scripts/ci/protected-paths.ts`,
        locations: failing.map((v) => ({
          file: v.path,
          line: v.line ?? 0,
          detail: v.detail,
        })),
        excerpt: markdown,
      })
    );
    process.exit(1);
  }
}
