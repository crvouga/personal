import { expect, test } from 'bun:test';
import { bootstrapRemote } from './remote-bootstrap';
import type { FleetNode } from './types';
const node: FleetNode = {
  id: 'devbox',
  ssh: 'devbox',
  workspace: '/unused',
  required: [],
};
const payload = {
  revision: 'a'.repeat(40),
  digest: 'b'.repeat(64),
  bundle: 'ZmFrZS1idW5kbGU=',
  script: '#!/bin/sh\n# fixture',
};
const success = {
  version: 1,
  checks: [
    {
      id: 'fixture:configuration',
      status: 'pass',
      summary: 'Verified fixture',
    },
  ],
};
const result = (stdout: string, ok = true) => ({
  ok,
  stdout,
  stderr: '',
  reason: 'exit' as const,
});
test('a verified cached source avoids resending the repository history', async () => {
  let invocation = 0;
  await bootstrapRemote(node, payload, async (args, options) => {
    invocation++;
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('-a');
    if (invocation === 1) return result('ready');
    expect(options?.input).toBe('');
    expect(args.at(-1)).toContain("'cached'");
    return result(JSON.stringify(success));
  });
  expect(invocation).toBe(2);
});
test('an absent cache transfers the verified bundle and preserves structured failure evidence', async () => {
  let invocation = 0;
  const report = await bootstrapRemote(node, payload, async (args, options) => {
    invocation++;
    if (invocation === 1) return result('', false);
    expect(options?.input).toBe(payload.bundle);
    expect(args.at(-1)).toContain("'transfer'");
    return result(
      JSON.stringify({
        version: 1,
        checks: [
          {
            id: 'bootstrap:prerequisites',
            status: 'fail',
            summary: 'SUDO_AUTHORIZATION_REQUIRED',
            secret: 'PRIVATE_SENTINEL',
          },
        ],
      }),
      false
    );
  });
  expect(report.checks[0]?.summary).toBe('SUDO_AUTHORIZATION_REQUIRED');
  expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL');
});
test('unknown host keys stop before sending any bootstrap payload', async () => {
  let calls = 0;
  const report = await bootstrapRemote(
    node,
    payload,
    async (_args, options) => {
      calls++;
      expect(options?.input).toBeUndefined();
      return {
        ok: false,
        reason: 'exit',
        stdout: '',
        stderr: 'Host key verification failed. PRIVATE_SENTINEL',
      };
    }
  );
  expect(calls).toBe(1);
  expect(report.checks[0]?.id).toBe('ssh:host-key');
  expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL');
});
test('partial pass evidence cannot mask a failed remote process', async () => {
  let calls = 0;
  const report = await bootstrapRemote(node, payload, async () => {
    calls++;
    return calls === 1
      ? result('ready')
      : result(JSON.stringify(success), false);
  });
  expect(
    report.checks.some(
      (check) => check.summary === 'REMOTE_BOOTSTRAP_EXIT_FAILED'
    )
  ).toBe(true);
});
