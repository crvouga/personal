import { expect, test } from 'bun:test';
import { inspectRoute } from './hub';
const hub = 'https://home.example.ts.net:8443';
test('private hub routing preserves unrelated routes and accepts only its expected proxy', () => {
  expect(inspectRoute('{}', hub)).toBe(false);
  const config = {
    TCP: { '8443': { HTTPS: true } },
    Web: {
      'home.example.ts.net:8443': {
        Handlers: { '/': { Proxy: 'http://127.0.0.1:8090' } },
      },
    },
  };
  expect(inspectRoute(JSON.stringify(config), hub)).toBe(true);
  expect(
    Array.isArray(
      inspectRoute(
        JSON.stringify({
          ...config,
          AllowFunnel: { 'home.example.ts.net:8443': true },
        }),
        hub
      )
    )
  ).toBe(true);
});
test('raw TCP and another application on the dashboard port require migration', () => {
  expect(
    Array.isArray(
      inspectRoute(
        JSON.stringify({ TCP: { '8443': { TCPForward: 'localhost:9999' } } }),
        hub
      )
    )
  ).toBe(true);
  expect(
    Array.isArray(
      inspectRoute(
        JSON.stringify({
          Web: {
            'home.example.ts.net:8443': {
              Handlers: { '/': { Proxy: 'http://localhost:9000' } },
            },
          },
        }),
        hub
      )
    )
  ).toBe(true);
});
test('a successful Serve command without observed routing cannot pass readiness', async () => {
  const { applyHub } = await import('./hub');
  let observations = 0;
  const checks = await applyHub('/fixture', hub, async (args) => {
    if (args.join(' ') === 'tailscale serve status --json') observations++;
    return { ok: true, stdout: '{}', stderr: '', reason: 'exit' };
  });
  expect(observations).toBe(2);
  expect(checks[0]?.summary).toBe('BESZEL_PRIVATE_ROUTE_UNVERIFIED');
});
