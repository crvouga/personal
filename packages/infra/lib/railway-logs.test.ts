import { expect, test } from 'bun:test';
import { readDeploymentLogTail } from './railway-logs';

test('failed image pulls expose build logs even when the container never starts', async () => {
  const lines = await readDeploymentLogTail({ deploymentId: 'deployment', token: 'credential' }, async (_url, options) => {
    const body = JSON.parse(String(options.body));
    expect(body.variables).toEqual({ deploymentId: 'deployment', limit: 40 });
    expect(body.query).toContain('buildLogs(');
    expect(body.query).toContain('deploymentLogs(');
    expect(body.query).not.toMatch(/mutation|subscription/);
    return Response.json({ data: { buildLogs: [{ timestamp: 'now', severity: 'error', message: 'image pull denied' }], deploymentLogs: [] } });
  });
  expect(lines).toEqual(['buildLogs: now error image pull denied']);
});

test('runtime diagnostics remain available and cannot inject workflow commands', async () => {
  const lines = await readDeploymentLogTail({ deploymentId: 'deployment', token: 'credential' }, async () => Response.json({ data: { buildLogs: [], deploymentLogs: [{ timestamp: 'now', message: 'failed\n::error::untrusted' }] } }));
  expect(lines).toEqual(['deploymentLogs: now  failed\n: :error: :untrusted']);
});

test('unavailable logs never mask the original rollout failure', async () => {
  for (const response of [new Response('', { status: 403 }), Response.json({ errors: [{ message: 'unavailable' }] })]) {
    expect(await readDeploymentLogTail({ deploymentId: 'deployment', token: 'credential' }, async () => response)).toEqual([]);
  }
});
