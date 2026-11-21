import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { stageT3Policy, verifyT3Policy } from './t3-policy';
import template from '../../../ubuntu/t3/policy.json';

test('policy observation tolerates startup without restarting or changing state', async () => {
  let calls = 0;
  let waits = 0;
  const result = await verifyT3Policy(
    '/pinned/t3',
    async (args, options) => {
      expect(args).toEqual(['/pinned/t3', 'policy', 'show']);
      expect(options?.timeoutMs).toBe(5000);
      calls++;
      return {
        ok: true,
        stdout: calls < 3 ? 'Not yet loaded.' : 'Server loaded this policy.',
        stderr: '',
        reason: 'exit',
      };
    },
    async () => {
      waits++;
    }
  );
  expect(result.status).toBe('pass');
  expect(waits).toBe(2);
});
test('policy observation stops at its bound and never promotes missing evidence', async () => {
  let calls = 0;
  const result = await verifyT3Policy(
    '/pinned/t3',
    async () => {
      calls++;
      return {
        ok: false,
        stdout: 'PRIVATE_SENTINEL',
        stderr: 'PRIVATE_SENTINEL',
        reason: 'timeout',
      };
    },
    async () => {}
  );
  expect(calls).toBe(6);
  expect(result.status).toBe('fail');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
});

test('staged policy is not reported active when native server still uses the previous policy', async () => {
  const check = await verifyT3Policy(
    '/managed/t3',
    async () => ({
      ok: true,
      stdout:
        'Server loaded the old policy. Restart T3 Code to apply the installed policy.',
      stderr: '',
      reason: 'exit',
    }),
    async () => {}
  );
  expect(check.status).toBe('fail');
  expect(check.summary).toBe('T3_POLICY_RESTART_PENDING');
});
test('native loaded-policy evidence is required', async () => {
  const check = await verifyT3Policy('/managed/t3', async () => ({
    ok: true,
    stdout: 'Server loaded this policy.\n',
    stderr: '',
    reason: 'exit',
  }));
  expect(check.status).toBe('pass');
});

test('the administrator policy locks limits only: providers live in settings', async () => {
  let document: unknown;
  const check = await stageT3Policy('/repo', '/pinned/t3', async (args) => {
    const file = args.at(-1)!.slice(1);
    document = JSON.parse(await readFile(file, 'utf8')).t3_policy_document;
    return { ok: true, stdout: '', stderr: '', reason: 'exit' };
  });
  expect(check.status).toBe('pass');
  expect(document).toEqual(template);
  expect(
    Object.keys((document as { settings?: object }).settings ?? {})
  ).toEqual([]);
});
