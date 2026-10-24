import { test, expect } from 'bun:test';
import { OsSecrets } from './keychain.ts';
import type { Command } from './process.ts';
test('OS-secret protocol uses bounded captured pipes and redacted values', async () => {
  const calls: Command[] = [];
  const secrets = new OsSecrets('workspace.password-manager', async (input) => {
    calls.push(input);
    const request = JSON.parse(input.input!) as { operation: string };
    return request.operation === 'get'
      ? JSON.stringify('SECRET_CANARY')
      : 'null';
  });
  await secrets.setSecret('operation/test/replacement', 'SECRET_CANARY');
  const value = await secrets.getRequired('operation/test/replacement');
  expect(value.readSecretValue()).toBe('SECRET_CANARY');
  expect(JSON.stringify(value)).not.toContain('SECRET_CANARY');
  expect(calls.every((call) => call.timeoutMs === 10000)).toBe(true);
  expect(
    calls.every((call) => !JSON.stringify(call.args).includes('SECRET_CANARY'))
  ).toBe(true);
  expect(
    calls.every(
      (call) => !JSON.stringify(call.env ?? {}).includes('SECRET_CANARY')
    )
  ).toBe(true);
  const failed = new OsSecrets('workspace.password-manager', async () => {
    throw new Error('NATIVE_SECRET_CANARY');
  });
  await expect(
    failed.getRequired('operation/test/replacement')
  ).rejects.toThrow('locked');
});
