import { expect, test } from 'bun:test';
import { checkVolumes } from './check-volumes.js';
import { fakeContext } from './fixtures.test-support.js';
import type { HealthContext } from './context.js';

function context(data?: unknown, status = 200): HealthContext {
  const base = fakeContext();
  return {
    ...base,
    config: { ...base.config, services: [{
      id: 'stateful',
      railway: {
        volume: { name: 'working', mount_path: '/var/lib/app' },
        draining_seconds: 60, health_timeout_seconds: 180,
      },
    }] },
    env: { RAILWAY_TOKEN: 'private-test-token' },
    run: async (_command, args) => ({
      code: 0, stderr: '',
      stdout: JSON.stringify(args.includes('service_ids') ? { stateful: 'service-id' } : 'environment-id'),
    }),
    fetch: (async (_url, options) => {
      expect(options?.method).toBe('POST');
      const body = JSON.parse(String(options?.body));
      expect(body.query.trim()).toStartWith('query ');
      expect(body.query).not.toContain('mutation');
      expect(body.variables).toEqual({ serviceId: 'service-id', environmentId: 'environment-id' });
      return Response.json({ data }, { status });
    }) as typeof fetch,
  };
}

function observation() {
  return {
    serviceInstance: {
      numReplicas: 1, drainingSeconds: 60, healthcheckTimeout: 180,
      activeDeployments: [{ id: 'one-writer' }],
    },
    environment: { config: { services: { "service-id": { deploy: {
      multiRegionConfig: { "us-west2": { numReplicas: 1 } },
    } } } }, volumeInstances: {
      edges: [{ node: { serviceId: 'service-id', mountPath: '/var/lib/app', volume: { name: 'working' } } }],
      pageInfo: { hasNextPage: false },
    } },
  };
}

test('volume writer health confirms the actual attachment, replica, deployment and budgets with reads only', async () => {
  expect((await checkVolumes(context(observation())))[0]?.status).toBe('pass');
});

test('volume writer health refuses overlapping deployments and attachment drift', async () => {
  const overlap = observation();
  overlap.serviceInstance.activeDeployments.push({ id: 'second-writer' });
  expect((await checkVolumes(context(overlap)))[0]?.status).toBe('fail');
  const wrongVolume = observation();
  wrongVolume.environment.volumeInstances.edges[0]!.node.mountPath = '/wrong';
  expect((await checkVolumes(context(wrongVolume)))[0]?.status).toBe('fail');
  const wrongBudget = observation();
  wrongBudget.serviceInstance.drainingSeconds = 0;
  expect((await checkVolumes(context(wrongBudget)))[0]?.status).toBe('fail');
});

test('volume writer health does not pass without credentials or initialized state', async () => {
  expect((await checkVolumes({ ...context(), env: {} }))[0]?.status).toBe('skip');
  const ctx = context();
  expect((await checkVolumes({ ...ctx, run: async () => ({ code: 1, stdout: '', stderr: 'private detail' }) }))[0]?.status).toBe('skip');
  expect((await checkVolumes(context(undefined, 403)))[0]?.status).toBe('skip');
});

test('volume writer health withholds response errors and credentials', async () => {
  const ctx = context();
  const request = (async () => { throw new Error('private-test-token'); }) as unknown as typeof fetch;
  const results = await checkVolumes({ ...ctx, fetch: request });
  expect(results[0]?.status).toBe('fail');
  expect(JSON.stringify(results)).not.toContain('private-test-token');
});

// Match live Railway responses: the legacy scalar is null, while regional
// replica counts live on the environment's current service configuration.
test('volume writer health accepts a null legacy replica field with one regional replica', async () => {
  const data = { ...observation(), serviceInstance: { ...observation().serviceInstance, numReplicas: null } };
  expect((await checkVolumes(context(data)))[0]?.status).toBe('pass');
});

test('volume writer health sums all regions and refuses missing replica proof', async () => {
  const data = observation();
  const deploy = data.environment.config.services['service-id'].deploy;
  for (const multiRegionConfig of [
    { 'us-west2': { numReplicas: 2 } },
    { 'us-west2': { numReplicas: 1 }, 'us-east4': { numReplicas: 1 } },
    { 'us-west2': { numReplicas: 0 } },
    {},
    { 'us-west2': { numReplicas: -1 } },
    { 'us-west2': { numReplicas: null } },
  ]) {
    const config = { services: { 'service-id': { deploy: { ...deploy, multiRegionConfig } } } };
    expect((await checkVolumes(context({ ...data, environment: { ...data.environment, config } })))[0]?.status).toBe('fail');
  }
  const { config: _config, ...environment } = data.environment;
  expect((await checkVolumes(context({ ...data, environment })))[0]?.status).toBe('fail');
});

test('volume writer health reports an unavailable writer even with a valid replica configuration', async () => {
  const data = observation();
  data.serviceInstance.activeDeployments = [];
  expect((await checkVolumes(context(data)))[0]).toMatchObject({
    status: 'fail', detail: expect.stringContaining('1 replicas and 0 active deployments'),
  });
});
