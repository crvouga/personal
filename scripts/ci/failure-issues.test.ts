import { expect, test } from 'bun:test';
import {
  plan,
  renderBody,
  summaryFor,
  title,
  type Job,
} from './failure-issues';

const job = (name: string, conclusion: string): Job => ({
  databaseId: 1,
  name,
  conclusion,
  url: `https://example.test/job/${name}`,
});
const names = (jobs: Job[]) => jobs.map((j) => j.name);

test('each failed job gets an issue; roll-ups only when nothing else failed', () => {
  const result = plan([
    job('Packages (tests)', 'failure'),
    job('Repository checks', 'success'),
    job('Check', 'failure'),
    job('Optional integrations', 'failure'),
    job('Deploy / Deploy', 'skipped'),
  ]);
  expect(names(result.open)).toEqual(['Packages (tests)']);
  expect(names(result.close)).toEqual(['Repository checks']);
  expect(names(plan([job('Check', 'failure')]).open)).toEqual(['Check']);
  expect(names(plan([job('Health', 'timed_out')]).open)).toEqual(['Health']);
});

test('skipped and cancelled jobs neither open nor close issues', () => {
  const result = plan([job('A', 'skipped'), job('B', 'cancelled')]);
  expect(result).toEqual({ open: [], close: [] });
});

test('titles are stable per workflow and job', () => {
  expect(title('CI', 'Packages (tests)')).toBe(
    'CI: Packages (tests) failing on main'
  );
});

test('the body names the failure, the repro and a JSON block', () => {
  const failed = job('Packages (tests)', 'failure');
  const summary = summaryFor(failed, [
    {
      job: 'Packages (tests)',
      command: 'bunx turbo run test',
      locations: [{ file: 'packages/x/a.test.ts', line: 12 }],
      excerpt: 'expected 1 got 2',
    },
  ]);
  const body = renderBody(
    { workflow: 'CI', sha: 'abcdef1234', runUrl: 'https://example.test/run' },
    failed,
    summary,
    ''
  );
  expect(body).toContain('`packages/x/a.test.ts:12`');
  expect(body).toContain('bunx turbo run test');
  expect(body).toContain('expected 1 got 2');
  expect(body).toContain('"job": "Packages (tests)"');
  expect(body).toContain('Fixes #');
});

test('jobs without a summary fall back to the failed-step log', () => {
  const body = renderBody(
    { workflow: 'Maintenance', sha: 'abcdef1234', runUrl: 'u' },
    job('Health', 'failure'),
    null,
    'FAIL dns'
  );
  expect(body).toContain('FAIL dns');
});
