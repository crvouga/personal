import { expect, test } from 'bun:test';
import { convergeT3Route } from './t3-route';
const identity = {
  BackendState: 'Running',
  Self: {
    ID: 'fixture',
    HostName: 'dev',
    DNSName: 'dev.fixture.ts.net.',
    OS: 'linux',
    Online: true,
    TailscaleIPs: ['100.64.0.1'],
  },
  Peer: {},
};
const route = {
  TCP: { '443': { HTTPS: true } },
  Web: {
    'dev.fixture.ts.net:443': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:3773' } },
    },
  },
};
const result = (value: unknown) => ({
  ok: true,
  stdout: JSON.stringify(value),
  stderr: '',
  reason: 'exit' as const,
});
test('existing private T3 route is verified without restart, pairing or Serve mutation', async () => {
  const calls: string[][] = [];
  const checks = await convergeT3Route(async (args) => {
    calls.push(args);
    return result(args[1] === 'status' ? identity : route);
  });
  expect(checks[0]?.status).toBe('pass');
  expect(calls).toHaveLength(3);
  expect(calls.every((args) => args[0] === 'tailscale')).toBe(true);
});
test('public Funnel access is a conflict, never automatically reset', async () => {
  const calls: string[][] = [];
  const checks = await convergeT3Route(async (args) => {
    calls.push(args);
    return result(
      args[1] === 'status'
        ? identity
        : { ...route, AllowFunnel: { 'dev.fixture.ts.net:443': true } }
    );
  });
  expect(checks[0]?.summary).toBe('T3_PRIVATE_ROUTE_CONFLICT');
  expect(calls).toHaveLength(2);
});
test('successful route command still requires an observed postcondition', async () => {
  const checks = await convergeT3Route(async (args) =>
    result(args[1] === 'status' ? identity : {})
  );
  expect(checks[0]?.summary).toBe('T3_PRIVATE_ROUTE_UNVERIFIED');
});
