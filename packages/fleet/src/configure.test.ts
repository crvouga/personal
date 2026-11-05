import { test, expect } from 'bun:test';
import {
  configureWorkspace,
  decodeReceipt,
  validConfiguration,
} from './configure';
import type { Runner } from './types';

const revision = 'a'.repeat(40);
const request = { revision, node: 'canary', tool: 'codex', profile: 'proxy' };

test('configuration requires exact commit and safe selectors', () => {
  expect(validConfiguration(request)).toBe(true);
  expect(validConfiguration({ ...request, revision: 'main' })).toBe(false);
  expect(validConfiguration({ ...request, node: '../escape' })).toBe(false);
  expect(
    decodeReceipt(
      JSON.stringify({ ok: true, revision, fingerprint: 'b'.repeat(64) }),
      revision
    )
  ).toBe('b'.repeat(64));
  expect(
    decodeReceipt(
      JSON.stringify({
        ok: true,
        revision: 'c'.repeat(40),
        fingerprint: 'b'.repeat(64),
      }),
      revision
    )
  ).toBeNull();
  expect(decodeReceipt('secret response', revision)).toBeNull();
});

test('unavailable revision fails without mutation or subprocess output leakage', async () => {
  const calls: string[][] = [];
  const run: Runner = async (command) => {
    calls.push(command);
    return {
      ok: false,
      stdout: 'PRIVATE_SENTINEL',
      stderr: 'PRIVATE_SENTINEL',
      reason: 'exit',
    };
  };
  const checks = await configureWorkspace('/unused', request, run);
  expect(checks[0]?.status).toBe('fail');
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(checks)).not.toContain('PRIVATE_SENTINEL');
});
