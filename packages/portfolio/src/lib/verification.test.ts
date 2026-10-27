/**
 * Pure parts of the verification refresh: the automation classifier, the
 * "failed CI before merge" join, the AI trailer and test call-site matchers,
 * and the snapshot loader's validation.
 *
 * Fixture sources for the call-site counter put every candidate call directly
 * after a quote (and join lines with `\n` at runtime), so this file's own
 * fixtures are not counted by the workspace call-site fact it tests.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  aiCoAuthoredPrNumbers,
  partitionPrs,
  prsFailedBeforeMerge,
  type MergedPr,
  type RunAttempt,
} from '../../scripts/verification/ci-join';
import {
  AUTOMATION_BRANCHES,
  aiTrailersIn,
  countTestCallSites,
  isAutomatedPr,
  isTestFile,
} from '../../scripts/verification/classify';
import { linkTarget } from '../../scripts/verification/github-client';
import { pickPrimaryWorkflow } from '../../scripts/verification/repo-stats';
import { windowFor } from '../../scripts/refresh-verification';
import { loadVerification, parseVerificationSnapshot } from './verification';

const pr = (
  overrides: Partial<MergedPr> & Pick<MergedPr, 'number'>
): MergedPr => ({
  createdAt: '2026-10-01T00:00:00Z',
  mergedAt: '2026-10-02T00:00:00Z',
  headRefName: `feat/${String(overrides.number)}`,
  authorLogin: 'crvouga',
  authorIsBot: false,
  commits: [{ oid: `sha-${String(overrides.number)}`, message: 'feat: x' }],
  ...overrides,
});

const run = (overrides: Partial<RunAttempt>): RunAttempt => ({
  runId: 1,
  attempt: 1,
  conclusion: 'failure',
  completedAt: '2026-10-01T12:00:00Z',
  headSha: 'unrelated',
  prNumbers: [],
  ...overrides,
});

describe('isAutomatedPr', () => {
  test('flags GraphQL bots and REST [bot] logins', () => {
    expect(
      isAutomatedPr({
        authorLogin: 'dependabot',
        authorIsBot: true,
        headRefName: 'x',
      })
    ).toBe(true);
    expect(
      isAutomatedPr({
        authorLogin: 'renovate[bot]',
        authorIsBot: false,
        headRefName: 'x',
      })
    ).toBe(true);
  });

  test('flags scheduled-automation branches even when a human PAT opened them', () => {
    for (const headRefName of AUTOMATION_BRANCHES) {
      expect(
        isAutomatedPr({
          authorLogin: 'crvouga',
          authorIsBot: false,
          headRefName,
        })
      ).toBe(true);
    }
  });

  test('keeps human PRs, including look-alike chore branches', () => {
    expect(
      isAutomatedPr({
        authorLogin: 'crvouga',
        authorIsBot: false,
        headRefName: 'chore/node-setup',
      })
    ).toBe(false);
    expect(
      isAutomatedPr({
        authorLogin: null,
        authorIsBot: false,
        headRefName: 'feat/x',
      })
    ).toBe(false);
  });

  const maintenance = resolve(
    import.meta.dir,
    '../../../../.github/workflows/maintenance.yml'
  );
  test.skipIf(!existsSync(maintenance))(
    'lists every branch maintenance.yml opens PRs from',
    () => {
      const source = readFileSync(maintenance, 'utf8');
      const assigned = [
        ...source.matchAll(/(?:REFRESH_BRANCH:|\bbranch=)\s*([\w./-]+)/g),
      ].map((m) => m[1]);
      expect(assigned.length).toBeGreaterThan(0);
      for (const branch of assigned)
        expect(AUTOMATION_BRANCHES).toContain(branch ?? '');
    }
  );
});

describe('prsFailedBeforeMerge', () => {
  const prs = [pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 })];

  test('joins through pull_requests[] and through head_sha', () => {
    const attempts = [
      run({ prNumbers: [1] }),
      run({ runId: 2, headSha: 'sha-2' }),
    ];
    expect(prsFailedBeforeMerge(prs, attempts)).toEqual([1, 2]);
  });

  test('ignores failures after merge and non-failure conclusions', () => {
    const attempts = [
      run({ prNumbers: [1], completedAt: '2026-10-03T00:00:00Z' }),
      run({ prNumbers: [2], conclusion: 'cancelled' }),
      run({ prNumbers: [3], conclusion: 'success' }),
      run({ prNumbers: [3], conclusion: null }),
    ];
    expect(prsFailedBeforeMerge(prs, attempts)).toEqual([]);
  });

  test('counts a failed first attempt even when the re-run passed', () => {
    const attempts = [
      run({ attempt: 2, conclusion: 'success', prNumbers: [3] }),
      run({ attempt: 1, conclusion: 'failure', prNumbers: [3] }),
    ];
    expect(prsFailedBeforeMerge(prs, attempts)).toEqual([3]);
  });

  test('ignores runs of PRs outside the counted set and counts each PR once', () => {
    const attempts = [
      run({ prNumbers: [99] }),
      run({ prNumbers: [1] }),
      run({ runId: 3, headSha: 'sha-1' }),
    ];
    expect(prsFailedBeforeMerge(prs, attempts)).toEqual([1]);
  });
});

describe('partitionPrs and windowFor', () => {
  test('splits PRs merged inside the window into human and automated', () => {
    const prs = [
      pr({ number: 1 }),
      pr({ number: 2, headRefName: 'chore/github-insights-refresh' }),
      pr({ number: 3, mergedAt: '2026-08-01T00:00:00Z' }),
    ];
    const { human, automated } = partitionPrs(
      prs,
      Date.parse('2026-09-01T00:00:00Z'),
      Date.parse('2026-10-26T00:00:00Z')
    );
    expect(human.map((entry) => entry.number)).toEqual([1]);
    expect(automated.map((entry) => entry.number)).toEqual([2]);
  });

  test('starts at the first merged PR when it is younger than 90 days', () => {
    const now = Date.parse('2026-10-26T18:00:00Z');
    const young = windowFor(
      [pr({ number: 1, mergedAt: '2026-09-17T02:48:46Z' })],
      now
    );
    expect(new Date(young.fromMs).toISOString()).toBe(
      '2026-09-17T00:00:00.000Z'
    );
    const old = windowFor(
      [pr({ number: 1, mergedAt: '2025-01-01T00:00:00Z' })],
      now
    );
    expect(new Date(old.fromMs).toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });
});

describe('AI co-author trailers', () => {
  test('match Claude (any model) and Cursor trailers, case-insensitively', () => {
    const message = [
      'feat: x',
      '',
      'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>',
      'Co-authored-by: Cursor <cursoragent@cursor.com>',
      'co-authored-by: claude <noreply@anthropic.com>',
    ].join('\n');
    expect(aiTrailersIn(message)).toEqual([
      'Claude Code',
      'Cursor',
      'Claude Code',
    ]);
  });

  test('ignore humans, mentions outside a trailer and look-alike names', () => {
    const message = [
      'Co-Authored-By: Jane Doe <jane@example.com>',
      'Reviewed with Claude; Co-Authored-By: Claude',
      'Co-Authored-By: Claudette <c@example.com>',
    ].join('\n');
    expect(aiTrailersIn(message)).toEqual([]);
  });

  test('aiCoAuthoredPrNumbers needs one trailer in any commit', () => {
    const prs = [
      pr({
        number: 2,
        commits: [
          { oid: 'a', message: 'x' },
          {
            oid: 'b',
            message: 'y\n\nCo-Authored-By: Claude Sonnet 5.5 <n@a.com>',
          },
        ],
      }),
      pr({ number: 1 }),
    ];
    expect(aiCoAuthoredPrNumbers(prs)).toEqual([2]);
  });
});

describe('countTestCallSites', () => {
  const lines = (...source: readonly string[]): string => source.join('\n');

  test('counts test and it calls with modifiers, at line start or after whitespace', () => {
    const source = lines(
      'test("a", () => {});',
      'it("b", () => {});',
      'test.each([1, 2])("c %d", () => {});',
      'it.skip.each([1])("d", () => {});',
      'test.if(true)("e", () => {});',
      'test.skipIf(false)("f", () => {});',
      'test.only("g", () => {});',
      'test.todo("h");',
      'it.concurrent("i", async () => {});',
      'describe("x", () => { ' + 'it("j", () => {}); });',
      '{' + 'test("k", () => {}); }'
    );
    expect(countTestCallSites(source)).toBe(11);
  });

  test('ignores identifiers ending in the letters and member calls', () => {
    const source = lines(
      'submit(form);',
      'split(",");',
      'wait(10);',
      'commit(tx);',
      'await audit(x);',
      'const ok = /re/.test(value);',
      'pattern.test(value);',
      'expect(it).toBeDefined();',
      'testing(x); itemize(y); test_(z);',
      '// count it (once) in prose'
    );
    expect(countTestCallSites(source)).toBe(0);
  });

  test('isTestFile matches the counted suffixes only', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.test.tsx')).toBe(true);
    expect(isTestFile('src/a.spec.ts')).toBe(true);
    expect(isTestFile('src/a.ts')).toBe(false);
    expect(isTestFile('node_modules/x/a.test.ts')).toBe(false);
  });
});

describe('GitHub helpers', () => {
  test('linkTarget reads rel="next" and rel="last"', () => {
    const headers = new Headers({
      link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
    });
    expect(linkTarget(headers, 'next')).toBe('https://api.github.com/x?page=2');
    expect(linkTarget(headers, 'last')).toBe('https://api.github.com/x?page=9');
    expect(linkTarget(new Headers(), 'next')).toBeNull();
  });

  test('pickPrimaryWorkflow prefers the workflow named CI over ci.yml', () => {
    const workflows = [
      {
        id: 1,
        name: 'Release',
        path: '.github/workflows/ci.yml',
        state: 'active',
      },
      { id: 2, name: 'CI', path: '.github/workflows/pr.yml', state: 'active' },
    ];
    expect(pickPrimaryWorkflow(workflows)?.id).toBe(2);
    expect(pickPrimaryWorkflow(workflows.slice(0, 1))?.id).toBe(1);
    expect(
      pickPrimaryWorkflow([
        { id: 3, name: 'CD', path: 'cd.yml', state: 'active' },
      ])
    ).toBeUndefined();
  });
});

describe('verification loader', () => {
  test('loads the committed snapshot with its age', () => {
    const { snapshot, freshness } = loadVerification(
      new Date(
        Date.parse(loadVerification().snapshot.fetchedAt) + 3 * 86_400_000
      )
    );
    expect(snapshot.workspace.mergedPrs).toBeGreaterThan(0);
    expect(freshness.ageInDays).toBe(3);
    expect(freshness.level).toBe('stale');
  });

  test('rejects malformed snapshots', () => {
    const { snapshot } = loadVerification();
    expect(() => parseVerificationSnapshot({})).toThrow(/malformed/);
    expect(() =>
      parseVerificationSnapshot({ ...snapshot, version: 2 })
    ).toThrow(/version/);
    expect(() => parseVerificationSnapshot({ ...snapshot, repos: [] })).toThrow(
      /repos/
    );
    const lying = {
      ...snapshot,
      workspace: { ...snapshot.workspace, prsFailedCiBeforeMerge: 0 },
    };
    expect(() => parseVerificationSnapshot(lying)).toThrow(/disagrees/);
  });
});
