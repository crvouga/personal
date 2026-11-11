import { expect, test } from 'bun:test';
import { plan, type PullRequest } from './agent-prs';

const pr = (overrides: Partial<PullRequest>): PullRequest => ({
  number: 1,
  headRefName: 't3/abc123',
  headRefOid: 'a'.repeat(40),
  author: { login: 'crvouga' },
  isDraft: false,
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

test('ready agent PRs get auto-merge; drafts and held PRs do not', () => {
  const ready = pr({ autoMergeRequest: null });
  expect(kinds(ready)).toEqual(['auto-merge']);
  expect(kinds(ready, 2)).toEqual(['update-branch', 'auto-merge']);
  expect(kinds({ ...ready, isDraft: true })).toEqual([]);
  expect(
    kinds({
      ...ready,
      labels: [{ name: 'agent-generated' }, { name: 'do-not-merge' }],
    })
  ).toEqual([]);
  expect(kinds({ ...ready, mergeable: 'CONFLICTING' })).toEqual(['conflict']);
  expect(kinds({ ...ready, headRefName: 'feature/x' })).toEqual([]);
});
