import { expect, test } from 'bun:test';
import { failedShas, MARKER, renderComment, type Run } from './pr-report';

const run = (overrides: Partial<Run>): Run => ({
  workflow: 'CI',
  conclusion: 'failure',
  sha: 'a'.repeat(40),
  url: 'https://example.test/run/1',
  failedJobs: ['Packages (quality)', 'Check'],
  summaries: [
    {
      job: 'Packages (quality)',
      command: 'bunx turbo run tc lint',
      locations: [{ file: 'packages/x/src/a.ts', line: 12 }],
      excerpt: 'error',
    },
  ],
  ...overrides,
});

test('a failure renders location, repro and an agent-readable block', () => {
  const { body, failures } = renderComment('', run({}));
  expect(body.startsWith(MARKER)).toBe(true);
  expect(body).toContain('`packages/x/src/a.ts:12`');
  expect(body).toContain('bunx turbo run tc lint');
  expect(body).toContain('Also failed: `Check`');
  const json = JSON.parse(/```json\n([\s\S]*?)```/.exec(body)![1]);
  expect(json.failures[0].locations[0]).toEqual({
    file: 'packages/x/src/a.ts',
    line: 12,
  });
  expect(failures).toHaveLength(1);
});

test('each workflow keeps its own section and the latest result replaces the old one', () => {
  const first = renderComment('', run({})).body;
  const guard = renderComment(
    first,
    run({
      workflow: 'Guardrails',
      summaries: [],
      failedJobs: ['protected-paths'],
    })
  ).body;
  const fixed = renderComment(
    guard,
    run({
      conclusion: 'success',
      sha: 'b'.repeat(40),
      summaries: [],
      failedJobs: [],
    })
  ).body;
  expect(fixed.match(/<!-- section:CI -->/g)).toHaveLength(1);
  expect(fixed).toContain('✅ CI: success');
  expect(fixed).toContain('❌ Guardrails: failure');
  expect(fixed.match(/## CI report/g)).toHaveLength(1);
});

test('failed attempts count distinct head commits', () => {
  let body = '';
  for (const sha of ['1', '1', '2', '3'])
    body = renderComment(body, run({ sha: sha.repeat(40) })).body;
  expect(failedShas(body)).toHaveLength(3);
});
