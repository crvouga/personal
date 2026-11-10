import { expect, test } from 'bun:test';
import {
  lastStep,
  locations,
  markdown,
  summarize,
} from './failure-summary.mjs';

const log = [
  '',
  '::ci-step::',
  'bun run ci:format',
  '::ci-output::',
  'All matched files use Prettier code style!',
  '',
  '::ci-step::',
  'bunx turbo run tc lint',
  '::ci-output::',
  '\x1b[31m@pkgs/x:tc: src/a.ts(12,5): error TS2322: nope\x1b[0m',
  'packages/x/src/b.ts:40:3  error  Unexpected any',
  'node_modules/y/index.js:1:1 ignored',
  '',
].join('\n');

test('the last recorded step is the one that failed', () => {
  expect(lastStep(log)!.command).toBe('bunx turbo run tc lint');
});

test('locations are extracted without ANSI codes or dependencies', () => {
  expect(locations(lastStep(log)!.output)).toEqual([
    { file: 'src/a.ts', line: 12 },
    { file: 'packages/x/src/b.ts', line: 40 },
  ]);
});

test('the summary names the job, where it failed and how to reproduce it', () => {
  const text = markdown(summarize({ job: 'Packages (quality)', log }));
  expect(text).toContain('### ❌ Packages (quality) failed');
  expect(text).toContain('`packages/x/src/b.ts:40`');
  expect(text).toContain('```bash\nbunx turbo run tc lint\n```');
});
