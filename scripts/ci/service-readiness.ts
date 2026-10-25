/** Verify the selected image is active; an older healthy deployment cannot pass. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  readDeployment,
  type Rollout,
} from '../../packages/infra/lib/railway-deployments';
import {
  deployableServices,
  loadServicesConfig,
} from '../../packages/infra/lib/services';

export type Target = {
  name: string;
  serviceId: string;
  image: string;
  after?: number;
};

export function rolloutState(
  target: Target,
  rollout: Rollout
): 'ready' | 'pending' | 'failed' {
  const latest = rollout.latest;
  if (!latest || latest.meta?.image !== target.image) return 'pending';
  if (
    target.after !== undefined &&
    !(Date.parse(latest.createdAt) >= target.after)
  )
    return 'pending';
  if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(latest.status))
    return 'failed';
  // Railway retains SLEEPING for a successfully deployed image scaled to zero.
  // Public readiness probes below this gate wake it and still must pass.
  if (latest.status === 'SLEEPING' && rollout.active.length === 0)
    return 'ready';
  return ['SUCCESS', 'SLEEPING'].includes(latest.status) &&
    rollout.active.some(
      (d) => d.id === latest.id && ['SUCCESS', 'SLEEPING'].includes(d.status)
    )
    ? 'ready'
    : 'pending';
}

export async function waitForService(
  target: Target,
  observe: () => Promise<Rollout>,
  options: {
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
    report?: (message: string) => void;
    timeoutMs?: number;
  } = {}
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Bun.sleep;
  const report = options.report ?? console.log;
  const deadline = now() + (options.timeoutMs ?? 900_000);
  for (let attempt = 0; attempt < 180 && now() < deadline; attempt++) {
    const rollout = await observe();
    const state = rolloutState(target, rollout);
    const status = rollout.latest?.status ?? 'not created';
    report(
      `${target.name}: deployment ${rollout.latest?.id ?? 'none'} ${status}; expected image ${target.image}`
    );
    if (state === 'ready') return;
    if (state === 'failed')
      throw new Error(
        `${target.name}: selected image deployment ${rollout.latest!.id} ${status}; an older healthy instance cannot satisfy rollout verification`
      );
    await sleep(5000);
  }
  throw new Error(
    `${target.name}: timed out waiting for the selected image to become active`
  );
}

function output<T>(root: string, name: string): T {
  return JSON.parse(
    execFileSync(
      'tofu',
      [`-chdir=packages/infra/tofu/${root}`, 'output', '-json', name],
      { encoding: 'utf8' }
    )
  );
}

export function rolloutTargets(input: {
  selected: string[];
  ids: Record<string, string>;
  tags: Record<string, string>;
  changes: string[];
  startedAt: number;
  explicitSelection?: boolean;
  revision?: string;
}): Target[] {
  const config = loadServicesConfig();
  if (!input.selected.length || !Number.isFinite(input.startedAt))
    throw new Error('Missing rollout selection or start time');
  const services = deployableServices(config);
  return input.selected
    .map((name) => {
      const service = services.find((service) => service.id === name);
      if (!service || !input.ids[name] || !input.tags[name])
        throw new Error(`Missing rollout state for ${name}`);
      const prefix = `module.service[${JSON.stringify(name)}].`;
      const changed = input.changes.some(
        (address) =>
          address.startsWith(prefix) &&
          /\.(railway_service|railway_variable_collection)\./.test(address)
      );
      return {
        name,
        serviceId: input.ids[name],
        image:
          service.image ??
          `ghcr.io/${config.image_owner}/${config.image_prefix}-${name}:${input.tags[name]}`,
        ...(changed ? { after: input.startedAt } : {}),
      };
    })
    .filter(
      (target) =>
        input.explicitSelection ||
        input.tags[target.name] === input.revision ||
        target.after !== undefined
    );
}

async function main() {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error('Missing RAILWAY_TOKEN for rollout verification');
  const environmentId = output<string>('foundation', 'environment_id');
  const targets = rolloutTargets({
    selected: JSON.parse(process.env.SERVICE_IDS ?? '[]'),
    ids: output('fleet', 'service_ids'),
    tags: output('fleet', 'image_tags'),
    changes: JSON.parse(process.env.ROLLOUT_CHANGES!),
    startedAt: Date.parse(process.env.ROLLOUT_STARTED_AT!),
    explicitSelection: ['repository_dispatch', 'workflow_dispatch'].includes(
      process.env.GITHUB_EVENT_NAME ?? ''
    ),
    revision: process.env.GITHUB_SHA,
  });
  const results = await Promise.allSettled(
    targets.map((target) =>
      waitForService(target, () =>
        readDeployment({ serviceId: target.serviceId, environmentId, token })
      )
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Service rollout verification failed'
    );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const messages =
      error instanceof AggregateError
        ? error.errors.map((e) => e.message).join('\n')
        : (error as Error).message;
    console.error(`::error title=Service rollout failed::${messages}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Service rollout failed\n\n${messages}\n`
      );
    process.exitCode = 1;
  }
}
