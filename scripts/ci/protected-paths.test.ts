import { expect, test } from 'bun:test';
import {
  blocking,
  evaluate,
  parseDiff,
  parseNameStatus,
  type Input,
  type Line,
} from './protected-paths';

const added = (path: string, text: string, line = 1): Line => ({
  path,
  line,
  text,
  added: true,
});
const removed = (path: string, text: string, line = 1): Line => ({
  path,
  line,
  text,
  added: false,
});
const input = (overrides: Partial<Input>): Input => ({
  changes: [],
  lines: [],
  labels: [],
  author: 'crvouga',
  ...overrides,
});
const rules = (i: Input) => evaluate(i).map((v) => v.rule);
const fails = (i: Input) => blocking(evaluate(i), i.labels).length > 0;

test('ordinary source changes pass', () => {
  const i = input({
    changes: [{ status: 'M', path: 'packages/portfolio/src/page.ts' }],
    lines: [added('packages/portfolio/src/page.ts', 'export const x = 1;')],
  });
  expect(fails(i)).toBe(false);
});

for (const path of [
  '.github/workflows/ci.yml',
  'packages/infra/tofu/foundation/repository.tf',
  'AGENTS.md',
  'packages/fleet/AGENTS.md',
  'CLAUDE.md',
  'packages/portfolio/eslint.config.js',
  'packages/eslint-rules/base-config.cjs',
  'tsconfig.strict.json',
  'packages/auth-relay/playwright.config.ts',
  'turbo.json',
  '.prettierrc',
  'commitlint.config.js',
  'scripts/ci/protected-paths.ts',
])
  test(`touching ${path} needs the needs-human label`, () => {
    const i = input({ changes: [{ status: 'M', path }] });
    expect(rules(i)).toContain('protected-path');
    expect(fails(i)).toBe(true);
    expect(fails({ ...i, labels: ['needs-human'] })).toBe(false);
  });

test('bun.lock and root package.json need deps or needs-human', () => {
  for (const path of ['bun.lock', 'package.json']) {
    const i = input({ changes: [{ status: 'M', path }] });
    expect(fails(i)).toBe(true);
    expect(fails({ ...i, labels: ['deps'] })).toBe(false);
    expect(fails({ ...i, labels: ['needs-human'] })).toBe(false);
  }
});

for (const text of [
  "test.only('x', () => {})",
  "describe.only('x', () => {})",
  "it.skip('x', () => {})",
  "test.skipIf(ci)('x', () => {})",
  "xit('x', () => {})",
  '// eslint-disable-next-line no-console',
  '/* eslint-disable */',
  '// @ts-ignore',
  '// @ts-expect-error broken types',
  '// @ts-nocheck',
])
  test(`adding \`${text}\` is blocked`, () => {
    const i = input({ lines: [added('packages/x/src/a.test.ts', text, 7)] });
    const [violation] = evaluate(i);
    expect(violation.rule).toBe('weakened-check');
    expect(violation.line).toBe(7);
    expect(fails(i)).toBe(true);
    expect(fails({ ...i, labels: ['needs-human'] })).toBe(false);
  });

test('python skips are blocked', () => {
  expect(
    rules(
      input({
        lines: [added('tests/test_a.py', '@pytest.mark.skip(reason="x")')],
      })
    )
  ).toEqual(['weakened-check']);
});

test('removing a suppression or mentioning it in docs passes', () => {
  const i = input({
    lines: [
      removed('packages/x/src/a.ts', '// @ts-ignore'),
      added('docs/guide.md', 'never use test.only'),
    ],
  });
  expect(fails(i)).toBe(false);
});

test('deleting a test file is blocked; renaming one is not', () => {
  for (const path of [
    'packages/x/src/a.test.ts',
    'packages/x/tests/flow.ts',
    'packages/y/test_api.py',
    'packages/infra/tofu/tests/foo.tftest.hcl',
  ])
    expect(rules(input({ changes: [{ status: 'D', path }] }))).toContain(
      'deleted-test'
    );
  expect(
    fails(
      input({ changes: [{ status: 'R100', path: 'packages/x/src/b.test.ts' }] })
    )
  ).toBe(false);
});

test('changing or removing an existing check script is blocked; adding one is not', () => {
  expect(
    fails(
      input({
        lines: [removed('packages/x/package.json', '    "test": "bun test",')],
      })
    )
  ).toBe(true);
  expect(
    fails(
      input({
        lines: [added('packages/x/package.json', '    "test": "bun test",')],
      })
    )
  ).toBe(false);
});

test('do-not-merge and pull_request_target cannot be waived', () => {
  const labelled = input({ labels: ['do-not-merge', 'needs-human'] });
  expect(fails(labelled)).toBe(true);
  const target = input({
    labels: ['needs-human'],
    changes: [{ status: 'M', path: '.github/workflows/x.yml' }],
    lines: [added('.github/workflows/x.yml', 'on: pull_request_target')],
  });
  expect(blocking(evaluate(target), target.labels).map((v) => v.rule)).toEqual([
    'pull-request-target',
  ]);
});

test('Dependabot may bump action pins without needs-human, but nothing else under .github', () => {
  const pinOnly = input({
    author: 'dependabot[bot]',
    labels: ['deps'],
    changes: [{ status: 'M', path: '.github/workflows/ci.yml' }],
    lines: [
      removed(
        '.github/workflows/ci.yml',
        '      - uses: actions/checkout@aaa # v5.0.0'
      ),
      added(
        '.github/workflows/ci.yml',
        '      - uses: actions/checkout@bbb # v5.1.0'
      ),
    ],
  });
  expect(fails(pinOnly)).toBe(false);
  const other = {
    ...pinOnly,
    lines: [
      ...pinOnly.lines,
      added('.github/workflows/ci.yml', '    if: false'),
    ],
  };
  expect(fails(other)).toBe(true);
  expect(fails({ ...pinOnly, author: 'crvouga' })).toBe(true);
});

test('diff parsing keeps paths and line numbers for added, removed and deleted files', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -3 +3,2 @@',
    '-old',
    '+new',
    '+// @ts-ignore',
    'diff --git a/gone.test.ts b/gone.test.ts',
    '--- a/gone.test.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    "-test('x')",
  ].join('\n');
  expect(parseDiff(diff)).toEqual([
    removed('a.ts', 'old', 3),
    added('a.ts', 'new', 3),
    added('a.ts', '// @ts-ignore', 4),
    removed('gone.test.ts', "test('x')", 1),
  ]);
  expect(parseNameStatus('M\ta.ts\nR090\told.ts\tnew.ts\n')).toEqual([
    { status: 'M', path: 'a.ts' },
    { status: 'R090', path: 'new.ts' },
  ]);
});
