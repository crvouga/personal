/** Read-only proof of the Railway volume and single-writer deployment contract. */
import type { ServiceSpec } from '../schema.js';
import type { HealthContext } from './context.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export const volumeQuery = `query VolumeWriter($serviceId: String!, $environmentId: String!) {
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    numReplicas drainingSeconds healthcheckTimeout activeDeployments { id }
  }
  environment(id: $environmentId) {
    volumeInstances(first: 100) {
      edges { node { serviceId mountPath volume { name } } }
      pageInfo { hasNextPage }
    }
  }
}`;

type Observation = {
  serviceInstance: {
    numReplicas: number | null;
    drainingSeconds: number | null;
    healthcheckTimeout: number | null;
    activeDeployments: { id: string }[];
  };
  environment: { volumeInstances: {
    edges: { node: { serviceId: string; mountPath: string; volume: { name: string } } }[];
    pageInfo: { hasNextPage: boolean };
  } };
};

async function output(ctx: HealthContext, root: string, name: string): Promise<unknown> {
  const result = await ctx.run('tofu', [
    `-chdir=${ctx.repoRoot}/packages/infra/tofu/${root}`, 'output', '-json', name,
  ], { timeoutMs: ctx.options.timeoutMs });
  if (result.code !== 0) throw new Error('OpenTofu output unavailable');
  return JSON.parse(result.stdout);
}

function judge(service: ServiceSpec, serviceId: string, observed: Observation): CheckResult {
  const name = `volume writer ${service.id}`;
  const wanted = service.railway!;
  const instance = observed.serviceInstance;
  const volumes = observed.environment.volumeInstances;
  if (volumes.pageInfo.hasNextPage) return skip(name, 'volume listing is incomplete; increase the read-only query budget');
  const attached = volumes.edges.map(({ node }) => node).filter((volume) => volume.serviceId === serviceId);
  if (attached.length !== 1 || attached[0]?.mountPath !== wanted.volume!.mount_path || attached[0]?.volume.name !== wanted.volume!.name)
    return fail(name, 'attached volume differs from inventory; single-writer deployment is not established');
  if (instance.numReplicas !== 1 || instance.activeDeployments.length !== 1)
    return fail(name, 'expected exactly one replica and one active deployment');
  const mismatch = [
    { label: 'graceful shutdown', expected: wanted.draining_seconds, actual: instance.drainingSeconds },
    { label: 'startup readiness', expected: wanted.health_timeout_seconds, actual: instance.healthcheckTimeout },
  ].find((budget) => budget.expected !== undefined && budget.actual !== budget.expected);
  if (mismatch) return fail(name, `${mismatch.label} budget differs from inventory`);
  return pass(name, 'declared volume attached; one replica/deployment; configured startup and shutdown budgets');
}

async function check(
  ctx: HealthContext, service: ServiceSpec, target: { serviceId: string; environmentId: string; token: string },
): Promise<CheckResult> {
  const name = `volume writer ${service.id}`;
  const { serviceId, environmentId, token } = target;
  try {
    const request = ctx.fetch;
    const response = await request('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: volumeQuery, variables: { serviceId, environmentId } }),
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    if ([401, 403].includes(response.status)) return skip(name, 'Railway credential cannot read volume/deployment settings');
    if (!response.ok) return fail(name, `Railway read failed (HTTP ${response.status})`);
    const result = await response.json() as { data?: Observation; errors?: unknown[] };
    if (!result.data || result.errors?.length) return fail(name, 'Railway volume/deployment query failed');
    return judge(service, serviceId, result.data);
  } catch {
    return fail(name, 'Railway volume/deployment read failed; response details withheld');
  }
}

export async function checkVolumes(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const services = ctx.config.services.filter((service) => service.railway?.volume && !service.standalone);
  if (!services.length) return [];
  const token = ctx.env['RAILWAY_TOKEN'] ?? ctx.env['RAILWAY_API_TOKEN'];
  if (!token) return services.map((service) => skip(`volume writer ${service.id}`, 'RAILWAY_TOKEN is required'));
  try {
    const [ids, environmentId] = await Promise.all([
      output(ctx, 'services', 'service_ids'), output(ctx, 'foundation', 'environment_id'),
    ]);
    if (!ids || typeof ids !== 'object' || typeof environmentId !== 'string') throw new Error();
    return Promise.all(services.map((service) => {
      const id = (ids as Record<string, unknown>)[service.id];
      return typeof id === 'string'
        ? check(ctx, service, { serviceId: id, environmentId, token })
        : fail(`volume writer ${service.id}`, 'service is absent from deployed OpenTofu outputs');
    }));
  } catch {
    return services.map((service) => skip(`volume writer ${service.id}`, 'initialize the services/foundation OpenTofu backends with state credentials'));
  }
}
