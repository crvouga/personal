import { expect, test } from 'bun:test';
import { repairInActions } from './ci';
import type { RunResult } from './process';

test('repair watches its dispatched ID without selecting a concurrent health/update run', async () => {
  const calls: string[][] = [];
  const result = await repairInActions(
    'acme/workspace',
    ['RAILWAY_TOKEN'],
    async (args, options) => {
      calls.push(args);
      if (args[1] === 'api') {
        expect(options?.capture).toBe(true);
        expect(args).toContain(
          'repos/acme/workspace/actions/workflows/maintenance.yml/dispatches'
        );
        expect(args).toContain('X-GitHub-Api-Version: 2026-03-10');
        expect(args).toContain('inputs[task]=vault-inputs');
        expect(args).toContain('inputs[from_vault]=RAILWAY_TOKEN');
        return { code: 0, stdout: '{"workflow_run_id":42}' };
      }
      return { code: 0, stdout: '' };
    }
  );
  expect(result).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual([
    'gh',
    'run',
    'watch',
    '42',
    '--repo',
    'acme/workspace',
    '--exit-status',
  ]);
});

for (const response of [
  { code: 1, stdout: '' },
  { code: 0, stdout: '' },
  { code: 0, stdout: '{}' },
  { code: 0, stdout: '{"workflow_run_id":"wrong"}' },
  { code: 0, stdout: '{"workflow_run_id":0}' },
] satisfies RunResult[])
  test(`an invalid dispatch cannot be reported as a successful repair: ${response.stdout || response.code}`, async () => {
    let calls = 0;
    expect(
      await repairInActions('acme/workspace', [], async () => {
        calls++;
        return response;
      })
    ).toBe(false);
    expect(calls).toBe(1);
  });

test('a failed dispatched repair remains a failure', async () => {
  expect(
    await repairInActions('acme/workspace', [], async (args) =>
      args[1] === 'api'
        ? { code: 0, stdout: '{"workflow_run_id":42}' }
        : { code: 1, stdout: '' }
    )
  ).toBe(false);
});
