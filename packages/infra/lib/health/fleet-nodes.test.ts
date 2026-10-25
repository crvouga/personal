import { describe, expect, test } from 'bun:test';
import { loadServicesConfig } from '../services.js';
import { checkFleetNodes, judgeNodes, readNodes } from './check-fleet-nodes.js';
import { checkServices } from './check-services.js';
import {
  CONFIG,
  PRD_KV,
  fakeContext,
  fakeFetch,
} from './fixtures.test-support.js';
import { HEALTH_GROUPS } from './run.js';

const URL = 'https://fleet.example.dev/v1/nodes';
const config = {
  ...CONFIG,
  services: [
    ...CONFIG.services,
    {
      id: 'fleet-api',
      hostname: 'fleet.example.dev',
      github_repo: 'acme/workspace',
      source_code_url: 'https://github.com/acme/workspace',
      dockerfile: 'packages/fleet-api/Dockerfile',
      build_context: '.',
      port: 8080,
      health_check: true,
      health_path: '/health',
    },
  ],
};

type View = {
  label: string;
  status: string;
  failedUnits?: string[];
  rolledBack?: boolean;
};
const view = ({
  label,
  status,
  failedUnits = [],
  rolledBack = false,
}: View): object => ({
  id: label.padEnd(64, '0'),
  hostname: label,
  label,
  status,
  facts: {
    failedUnits,
    sync: { rolledBack, healthFailure: null, paused: false },
    readiness: { issues: [] },
  },
});

/** Answers the node list and records the Authorization header it was called with. */
function nodesFetch(
  body: unknown,
  status = 200,
  sent: string[] = []
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(URL);
    sent.push(new Headers(init?.headers).get('authorization') ?? '');
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const run = (
  nodes: readonly View[],
  env: Record<string, string> = { FLEET_ADMIN_TOKEN: 'admin-token' }
) =>
  checkFleetNodes(
    fakeContext({ config, env, fetch: nodesFetch(nodes.map(view)) })
  );

describe('fleet nodes', () => {
  test('a healthy fleet passes with the counts', async () => {
    const sent: string[] = [];
    const results = await checkFleetNodes(
      fakeContext({
        config,
        env: { FLEET_ADMIN_TOKEN: 'admin-token' },
        fetch: nodesFetch(
          [
            view({ label: 'ci-a3f9', status: 'online' }),
            view({ label: 'web-1b2c', status: 'online' }),
            view({ label: 'old', status: 'retired' }),
          ],
          200,
          sent
        ),
      })
    );
    expect(results).toEqual([
      {
        name: 'fleet nodes',
        status: 'pass',
        detail: '3 node(s): 2 online, 1 retired',
      },
    ]);
    expect(sent).toEqual(['Bearer admin-token']);
  });

  test('an approved node that went offline fails and is named', async () => {
    const [result] = await run([
      view({ label: 'ci-a3f9', status: 'offline' }),
      view({ label: 'ci-b4e0', status: 'online' }),
    ] as View[]);
    expect(result!.status).toBe('fail');
    expect(result!.detail).toContain('offline: ci-a3f9');
    expect(result!.detail).not.toContain('ci-b4e0');
  });

  test('stale, pending, rolled back and failing nodes warn with their names', async () => {
    const [result] = await run([
      { label: 'ci-1', status: 'stale' },
      { label: 'web-2', status: 'pending' },
      { label: 'cache-3', status: 'online', rolledBack: true },
      {
        label: 'devbox-4',
        status: 'online',
        failedUnits: ['nginx.service', 'fleet-sync.service'],
      },
      {
        label: 'gone',
        status: 'retired',
        failedUnits: ['ignored.service'],
        rolledBack: true,
      },
    ]);
    expect(result!.status).toBe('warn');
    for (const part of [
      'stale: ci-1',
      'pending approval: web-2',
      'rolled back: cache-3',
      'failed units: devbox-4 (nginx.service, fleet-sync.service)',
    ]) {
      expect(result!.detail).toContain(part);
    }
    expect(result!.detail).not.toContain('gone');
  });

  test('an offline node outranks warnings but warnings stay in the detail', () => {
    const result = judgeNodes(
      readNodes([
        view({ label: 'a', status: 'offline' }),
        view({ label: 'b', status: 'stale' }),
      ])!
    );
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('stale: b');
  });

  test('a fleet with no nodes cannot claim installed runner readiness', async () => {
    expect((await run([]))[0]).toMatchObject({
      status: 'warn',
      detail: 'no nodes have registered yet; installed runner readiness is unverified',
    });
  });

  test('online heartbeat alone does not hide unknown readiness or broken synchronization', () => {
    const unknown = { ...view({ label: 'ci-1', status: 'online' }), facts: {} };
    const broken = {
      ...view({ label: 'ci-2', status: 'online' }),
      facts: { readiness: { issues: ['GitHub runner registration has not been verified'] }, sync: { healthFailure: 'cached revision cannot be activated' } },
    };
    const result = judgeNodes(readNodes([unknown, broken])!);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('readiness unknown: ci-1');
    expect(result.detail).toContain('not ready: ci-2');
    expect(result.detail).toContain('sync failure: ci-2');
  });

  test('long lists are summarized', () => {
    const labels = Array.from({ length: 9 }, (_, index) => `n${index}`);
    const result = judgeNodes(
      readNodes(labels.map((label) => view({ label, status: 'offline' })))!
    );
    expect(result.detail).toContain('and 3 more');
  });

  test('a { nodes } envelope is accepted and non-nodes are ignored', () => {
    expect(
      readNodes({
        nodes: [view({ label: 'a', status: 'online' }), 'junk', null],
      })
    ).toHaveLength(1);
    expect(readNodes({ error: 'x' })).toBeUndefined();
  });

  test('without a token the check skips, never passes', async () => {
    const results = await run(
      [view({ label: 'a', status: 'online' }) as View],
      {}
    );
    expect(results[0]!.status).toBe('skip');
  });

  test('the token may come from the production Vault document', async () => {
    const sent: string[] = [];
    const results = await checkFleetNodes(
      fakeContext({
        config,
        kv: async () => ({
          ok: true,
          data: { ...PRD_KV, FLEET_ADMIN_TOKEN: 'vault-token-value' },
        }),
        fetch: nodesFetch([], 200, sent),
      })
    );
    expect(results[0]!.status).toBe('warn');
    expect(sent).toEqual(['Bearer vault-token-value']);
  });

  test('an unreadable Vault with no environment token skips', async () => {
    const results = await checkFleetNodes(
      fakeContext({
        config,
        kv: async () => ({
          ok: false,
          reason: 'no Vault token',
          unverifiable: true,
        }),
      })
    );
    expect(results[0]!.status).toBe('skip');
  });

  test('an API that is down or errors fails', async () => {
    const env = { FLEET_ADMIN_TOKEN: 't' };
    const unreachable = await checkFleetNodes(
      fakeContext({
        config,
        env,
        fetch: fakeFetch({ [URL]: new Error('ECONNREFUSED') }),
      })
    );
    expect(unreachable[0]).toMatchObject({ status: 'fail' });
    expect(unreachable[0]!.detail).toContain('fleet API is down');
    const broken = await checkFleetNodes(
      fakeContext({ config, env, fetch: nodesFetch({ error: 'db' }, 503) })
    );
    expect(broken[0]).toMatchObject({ status: 'fail' });
    const garbage = await checkFleetNodes(
      fakeContext({ config, env, fetch: nodesFetch({ unexpected: true }) })
    );
    expect(garbage[0]!.detail).toContain('did not return a node list');
  });

  test('a rejected token fails and says so', async () => {
    const results = await checkFleetNodes(
      fakeContext({
        config,
        env: { FLEET_ADMIN_TOKEN: 'stale' },
        fetch: nodesFetch({ error: 'unauthorized' }, 401),
      })
    );
    expect(results[0]).toMatchObject({ status: 'fail' });
    expect(results[0]!.detail).toContain('rejected FLEET_ADMIN_TOKEN');
  });

  test('an inventory without fleet-api skips', async () => {
    const results = await checkFleetNodes(
      fakeContext({ env: { FLEET_ADMIN_TOKEN: 't' } })
    );
    expect(results[0]!.status).toBe('skip');
  });
});

describe('fleet-api in the inventory', () => {
  test('the services check probes its health endpoint', async () => {
    const seen: string[] = [];
    const results = await checkServices(
      fakeContext({ config: loadServicesConfig(), fetch: fakeFetch({}, seen) })
    );
    expect(seen).toContain('https://fleet.chrisvouga.dev/health');
    expect(results.find((result) => result.name === 'fleet-api')).toMatchObject(
      { status: 'pass' }
    );
  });

  test('the group is registered after the runner fleet', () => {
    const ids = HEALTH_GROUPS.map((group) => group.id);
    expect(ids.indexOf('fleet-nodes')).toBe(ids.indexOf('runners') + 1);
  });
});
