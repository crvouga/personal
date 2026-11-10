import { expect, test } from 'bun:test';
import { plan, type PullRequest } from './agent-prs';

const pr = (overrides: Partial<PullRequest>): PullRequest => ({
  number: 1,
  headRefName: 't3/abc123',
  headRefOid: 'a'.repeat(40),
  author: { login: 'crvouga' },
  labels: [{ name: 'agent-generated' }],
  mergeable: 'MERGEABLE',
  autoMergeRequest: { mergeMethod: 'SQUASH' },
  ...overrides,
});
const kinds = (p: PullRequest, behind = 0) =>
  plan(p, behind).map((a) => a.kind);

test('agent branches are labeled; human branches are left alone', () => {
  expect(plan(pr({ labels: [] }), 0)).toEqual([
    { kind: 'label', label: 'agent-generated' },
  ]);
  expect(kinds(pr({ headRefName: 'agent/fix-x', labels: [] }))).toEqual([
    'label',
  ]);
  expect(kinds(pr({ headRefName: 'feature/x', labels: [] }), 5)).toEqual([]);
});

test('behind branches are updated; current ones are not', () => {
  expect(kinds(pr({}), 3)).toEqual(['update-branch']);
  expect(kinds(pr({}), 0)).toEqual([]);
  expect(kinds(pr({ mergeable: 'UNKNOWN' }), 3)).toEqual([]);
});

test('conflicts are reported once', () => {
  expect(kinds(pr({ mergeable: 'CONFLICTING' }), 3)).toEqual(['conflict']);
  expect(
    kinds(
      pr({
        mergeable: 'CONFLICTING',
        labels: [{ name: 'agent-generated' }, { name: 'needs-human' }],
      }),
      3
    )
  ).toEqual([]);
});

test('Dependabot PRs get deps and auto-merge unless held', () => {
  const bot = pr({
    headRefName: 'dependabot/bun/x',
    author: { login: 'app/dependabot' },
    labels: [],
    autoMergeRequest: null,
  });
  expect(plan(bot, 0)).toEqual([
    { kind: 'label', label: 'deps' },
    { kind: 'auto-merge' },
  ]);
  expect(
    kinds({ ...bot, labels: [{ name: 'deps' }, { name: 'do-not-merge' }] })
  ).toEqual([]);
});
