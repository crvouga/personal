import { expect, test } from 'bun:test';
import { convergeProxy } from './proxy-converge';
import type { Runner } from './types';

const revision = 'a'.repeat(40);
function proxy(phases: object[]) {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push([...args]);
    return {
      ok: true,
      reason: 'exit',
      stderr: '',
      stdout: JSON.stringify({ version: 1, phases }),
    };
  };
  return { run, calls };
}

test('maintenance is passed through only when asked', async () => {
  const plain = proxy([{ code: 'PROXY_CLIENT_ROLE', status: 'unchanged' }]);
  await convergeProxy('node', revision, plain.run);
  expect(plain.calls[0]).toContain('--apply');
  expect(plain.calls[0]).not.toContain('--maintenance');
  const window = proxy([{ code: 'PROXY_CLIENT_ROLE', status: 'unchanged' }]);
  await convergeProxy('node', revision, window.run, { maintenance: true });
  expect(window.calls[0]).toContain('--maintenance');
});

test("the proxy's own remedy reaches the report", async () => {
  const { run } = proxy([
    {
      code: 'PROXY_UPDATE_PENDING',
      status: 'action-required',
      remedy: { action: 'Apply it with: personal fleet-sync --maintenance' },
    },
    { code: 'PROXY_SOURCE_DRIFT', status: 'action-required', remedy: 7 },
  ]);
  const [pending, drift] = await convergeProxy('node', revision, run);
  expect(pending?.remedy?.action).toContain('fleet-sync --maintenance');
  expect(drift?.remedy?.action).toContain('audit/recovery runbook');
});
