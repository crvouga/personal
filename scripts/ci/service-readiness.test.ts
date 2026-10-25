import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  readDeployment,
  deploymentQuery,
  type Rollout,
} from '../../packages/infra/lib/railway-deployments';
import {
  rolloutState,
  rolloutTargets,
  waitForService,
} from './service-readiness';

const image = 'ghcr.io/example/movie:new';
const target = { name: 'movie', serviceId: 'service-id', image };
function observation(status = 'SUCCESS', overrides = {}): Rollout {
  return {
    latest: {
      id: 'new',
      status,
      createdAt: '2026-10-25T10:00:00Z',
      meta: { image },
      ...overrides,
    },
    active: [{ id: 'new', status: 'SUCCESS' }],
  };
}

test('an old healthy deployment cannot hide failure, pending activation, wrong image or stale configuration', () => {
  expect(rolloutState(target, observation())).toBe('ready');
  for (const status of ['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']) {
    const rollout = {
      ...observation(status),
      active: [{ id: 'old', status: 'SUCCESS' }],
    };
    expect(rolloutState(target, rollout)).toBe('failed');
  }
  expect(rolloutState(target, observation('DEPLOYING'))).toBe('pending');
  expect(
    rolloutState(target, observation('SUCCESS', { meta: { image: 'old' } }))
  ).toBe('pending');
  expect(
    rolloutState(target, {
      ...observation(),
      active: [{ id: 'old', status: 'SUCCESS' }],
    })
  ).toBe('pending');
  expect(
    rolloutState(
      { ...target, after: Date.parse('2026-10-25T11:00:00Z') },
      observation()
    )
  ).toBe('pending');
  expect(rolloutState(target, { latest: undefined, active: [] })).toBe(
    'pending'
  );
  expect(rolloutState(target, { ...observation('SLEEPING'), active: [] })).toBe(
    'ready'
  );
  expect(
    rolloutState(target, {
      ...observation('SLEEPING'),
      active: [{ id: 'new', status: 'SLEEPING' }],
    })
  ).toBe('ready');
  expect(
    rolloutState(target, observation('SLEEPING', { meta: { image: 'old' } }))
  ).toBe('pending');
});

test('polling waits for activation and fails closed on terminal failure, query failure and timeout', async () => {
  let time = 0;
  let attempts = 0;
  const options = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    report: () => {},
    timeoutMs: 15_000,
  };
  await waitForService(
    target,
    async () => observation(++attempts === 1 ? 'DEPLOYING' : 'SUCCESS'),
    options
  );
  expect(attempts).toBe(2);
  await expect(
    waitForService(target, async () => observation('FAILED'), options)
  ).rejects.toThrow('older healthy');
  await expect(
    waitForService(
      target,
      async () => {
        throw new Error('query unavailable');
      },
      options
    )
  ).rejects.toThrow('query unavailable');
  await expect(
    waitForService(target, async () => observation('DEPLOYING'), options)
  ).rejects.toThrow('timed out');
});

test('rollout targets require a new deployment for changed variables even when the image tag is unchanged', () => {
  const input = {
    selected: ['moviefinder'],
    ids: { moviefinder: 'service' },
    tags: { moviefinder: 'commit' },
    changes: [] as string[],
    startedAt: 123,
    explicitSelection: true,
  };
  expect(rolloutTargets(input)[0]!.after).toBeUndefined();
  expect(rolloutTargets({ ...input, explicitSelection: false })).toEqual([]);
  expect(
    rolloutTargets({ ...input, explicitSelection: false, revision: 'commit' })
  ).toHaveLength(1);
  input.changes = [
    'module.service["moviefinder"].railway_variable_collection.this',
  ];
  expect(rolloutTargets(input)[0]).toMatchObject({
    after: 123,
    image: 'ghcr.io/crvouga/chrisvouga-moviefinder:commit',
  });
  expect(rolloutTargets({ ...input, explicitSelection: false })[0]!.after).toBe(
    123
  );
  input.changes = [
    'module.service["moviefinder"].cloudflare_dns_record.traffic',
  ];
  expect(rolloutTargets(input)[0]!.after).toBeUndefined();
  input.changes = ['module.service["moviefinder"].graphql_mutation.settings'];
  expect(rolloutTargets({ ...input, explicitSelection: false })).toEqual([]);
  expect(() => rolloutTargets({ ...input, tags: {} })).toThrow(
    'Missing rollout state'
  );
  expect(() => rolloutTargets({ ...input, startedAt: NaN })).toThrow(
    'start time'
  );
});

test('the Railway adapter sends only the fixed read query and does not expose response diagnostics', async () => {
  const request = async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(options.method).toBe('POST');
    expect(body).toEqual({
      query: deploymentQuery,
      variables: { serviceId: 'service', environmentId: 'environment' },
    });
    return Response.json({
      data: {
        deployments: { edges: [{ node: observation().latest }] },
        serviceInstance: { activeDeployments: observation().active },
      },
    });
  };
  const input = {
    serviceId: 'service',
    environmentId: 'environment',
    token: 'secret',
  };
  expect(await readDeployment(input, request)).toEqual(observation());
  await expect(
    readDeployment(input, async () =>
      Response.json({
        errors: [{ message: 'sensitive upstream text' }],
      })
    )
  ).rejects.toThrow('verify deployment credentials');
  await expect(
    readDeployment(input, async () => new Response('', { status: 403 }))
  ).rejects.toThrow('HTTP 403');
});

test('the deployment workflow verifies the selected rollout before public health and smoke', () => {
  const steps = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')).jobs
    .deploy.steps;
  const index = steps.findIndex(
    (step: any) => step.name === 'Verify active service deployments'
  );
  expect(index).toBeGreaterThan(
    steps.findIndex((step: any) => step.name === 'Deploy services')
  );
  expect(index).toBeLessThan(
    steps.findIndex((step: any) => step.name === 'Check public services')
  );
  expect(steps[index].if).toBe("steps.plan.outputs.services == 'true'");
  expect(steps[index].env.ROLLOUT_CHANGES).toBe(
    '${{ steps.services.outputs.changed_resources }}'
  );
});
