import { expect, test } from 'bun:test';
import { mustRun } from '../scripts/release-io';
import { npmFailureHint } from '../scripts/release-diagnostics';

test('publish failures identify authentication without exposing npm response bodies', async () => {
  const failure = mustRun(
    ['npm', 'publish'],
    '/',
    {},
    {
      stage: 'publish',
      run: async () => ({
        ok: false,
        reason: 'exit',
        stdout: 'synthetic-secret',
        stderr: 'npm error code ENEEDAUTH\nnpm error synthetic-secret',
      }),
    }
  );
  await expect(failure).rejects.toThrow('ENEEDAUTH');
  await expect(failure).rejects.toThrow('trusted publisher');
  await expect(failure).rejects.not.toThrow('synthetic-secret');
});

test('diagnostics accept only complete npm error-code lines from a fixed allowlist', () => {
  expect(npmFailureHint('npm ERR! code E403\nprivate response')).toContain(
    'E403'
  );
  for (const output of [
    'npm error code SECRET',
    'npm error code E403 secret',
    'untrusted response ENEEDAUTH',
    'npm error code constructor',
  ])
    expect(npmFailureHint(output)).toBe('');
});
