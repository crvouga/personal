import { expect, test } from 'bun:test';
import { verifyT3Policy } from './t3-policy';

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
