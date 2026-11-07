import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { workstationChecks } from './workstation-checks';
import { failure, success } from './test-fixtures';

test('workstation diagnostics are read-only and discard all private fields', async () => {
  const checks = await workstationChecks('/repo', async (command, options) => {
    expect(command).toEqual([
      'bun',
      join('/repo', 'packages/personal-cli/src/cli.ts'),
      'workstation',
      'doctor',
      '--json',
      '--non-interactive',
    ]);
    expect(options).toMatchObject({ cwd: '/repo', timeoutMs: 20_000 });
    return success(
      JSON.stringify({
        ok: true,
        checks: [
          { id: 'codex-config', severity: 'pass', detail: 'private-secret' },
          { id: 'path', severity: 'warn', fix: 'private-secret' },
        ],
      })
    );
  });
  expect(checks.map((check) => check.status)).toEqual(['pass', 'warn']);
  expect(JSON.stringify(checks)).not.toContain('private-secret');
});

test('invalid, empty and failed workstation diagnostics never pass', async () => {
  for (const value of [
    'not json',
    '{}',
    '{"ok":true,"checks":[]}',
    '{"ok":true,"checks":[{"id":"private secret","severity":"pass"}]}',
    '{"ok":true,"checks":[{"id":"one","severity":"unknown"}]}',
  ]) {
    expect(
      (await workstationChecks('/repo', async () => success(value)))[0]?.status
    ).toBe('fail');
  }
  const checks = await workstationChecks('/repo', async () => ({
    ...failure(),
    stdout: '{"ok":false,"checks":[{"id":"one","severity":"pass"}]}',
  }));
  expect(checks[0]?.status).toBe('fail');
});
