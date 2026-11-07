import { expect, test } from 'bun:test';
import { verifyT3Policy } from './t3-policy';
const result = (stdout: string) => ({
  ok: true,
  stdout,
  stderr: '',
  reason: 'exit' as const,
});
test('staged policy is not reported active when native server still uses the previous policy', async () => {
  const check = await verifyT3Policy('/managed/t3', async () =>
    result(
      'Server loaded the old policy. Restart T3 Code to apply the installed policy.'
    )
  );
  expect(check.status).toBe('fail');
  expect(check.summary).toBe('T3_POLICY_RESTART_PENDING');
});
test('native loaded-policy evidence is required', async () => {
  const check = await verifyT3Policy('/managed/t3', async () =>
    result('Server loaded this policy.\n')
  );
  expect(check.status).toBe('pass');
});
