/** Select existing inventory resources and images; this script never provisions anything. */
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  deployableServices,
  infraGithubRepo,
  loadServicesConfig,
  type InfraConfig,
} from '../../packages/infra/lib/services';

type Request = {
  event: string;
  action: string;
  paths: readonly string[];
  serviceId?: string;
  imageTag?: string;
  sha: string;
  recoverVault?: boolean;
};

export function deploymentPlan(config: InfraConfig, request: Request) {
  const { event, action, paths, sha } = request;
  if (
    !['auto', 'release', 'deploy', 'auth', 'unseal', 'smoke'].includes(action)
  )
    throw new Error(`Unknown deployment action: ${action}`);
  const services = deployableServices(config);
  const local = services.filter(
    (s) => s.github_repo === infraGithubRepo(config)
  );
  const serviceId = request.serviceId ?? '';
  if (serviceId && !services.some((s) => s.id === serviceId))
    throw new Error(`Unknown deployable service: ${serviceId}`);
  if (event === 'repository_dispatch' && !serviceId)
    throw new Error('deploy-service requires a service id');
  const changed = (pattern: RegExp) => paths.some((p) => pattern.test(p));
  const shared = changed(
    /^(bun\.lock|package\.json|turbo\.json|tsconfig(?:\.strict)?\.json|\.dockerignore)$|^packages\/(assert|logger|object-store|secret-store|secret-string|vault)\//
  );
  const imageChanged = local.some((s) => {
    const directory = s.dockerfile?.slice(0, s.dockerfile.lastIndexOf('/') + 1);
    return directory && paths.some((p) => p.startsWith(directory));
  });
  const automatic = event === 'push' && action === 'auto';
  const build =
    event === 'schedule' ||
    action === 'release' ||
    (automatic && (shared || imageChanged));
  const vault =
    automatic &&
    (changed(/^packages\/vault-service\//) || !!request.recoverVault);
  const authChanged = changed(
    /^packages\/auth-relay\/|^packages\/infra\/tofu\/(auth[^/]*\/|modules\/auth-|foundation\/auth-relay\.tf|modules\/inventory\/)|^\.github\/|^scripts\/(ci\/|tofu-plan\.ts)/
  );
  const auth =
    !!config.auth_relay?.enabled &&
    (action === 'auth' || (automatic && authChanged));
  const infrastructure =
    automatic &&
    changed(/^packages\/infra\/|^\.github\/|^scripts\/(ci\/|tofu-plan\.ts)/);
  const apply =
    build ||
    vault ||
    auth ||
    infrastructure ||
    action === 'deploy' ||
    action === 'unseal';
  let targets = build ? local : services;
  if (event === 'schedule') targets = local.filter((s) => s.id === 'portfolio');
  else if (serviceId) targets = targets.filter((s) => s.id === serviceId);
  if (build && !targets.length)
    throw new Error('No locally built services match this release');
  const imageTag = build
    ? sha
    : event === 'repository_dispatch' || action === 'deploy'
      ? request.imageTag || 'latest'
      : '';
  if (imageTag && !/^[\w][\w.-]{0,127}$/.test(imageTag))
    throw new Error('Invalid image tag');
  return {
    apply,
    build,
    vault,
    auth,
    services:
      apply &&
      action !== 'unseal' &&
      action !== 'auth' &&
      (build || vault || infrastructure || action === 'deploy'),
    service_ids: targets.map((s) => s.id),
    image_tag: imageTag,
    smoke: action !== 'auth' || auth,
  };
}

if (import.meta.main) {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')
  );
  const sha = process.env.GITHUB_SHA!;
  const eventName = process.env.EVENT!;
  const action =
    eventName === 'repository_dispatch' ? 'deploy' : process.env.ACTION!;
  const paths =
    eventName === 'push'
      ? execFileSync(
          'git',
          /^0+$/.test(event.before)
            ? ['ls-files']
            : ['diff', '--name-only', event.before, sha],
          {
            encoding: 'utf8',
          }
        )
          .trim()
          .split('\n')
      : [];
  let recoverVault = false;
  if (eventName === 'push') {
    try {
      const response = await fetch(
        `${process.env.VAULT_ADDR}/v1/sys/health?standbyok=true&perfstandbyok=true`,
        { method: 'GET', signal: AbortSignal.timeout(15_000) }
      );
      recoverVault = ![200, 429, 472, 473].includes(response.status);
    } catch {
      recoverVault = true;
    }
  }
  const plan = deploymentPlan(loadServicesConfig(), {
    event: eventName,
    action,
    paths,
    sha,
    recoverVault,
    serviceId:
      eventName === 'repository_dispatch'
        ? process.env.CLIENT_ID
        : process.env.INPUT_ID,
    imageTag:
      eventName === 'repository_dispatch'
        ? process.env.CLIENT_TAG
        : process.env.INPUT_TAG,
  });
  for (const [key, value] of Object.entries(plan))
    appendFileSync(
      process.env.GITHUB_OUTPUT!,
      `${key}=${Array.isArray(value) ? JSON.stringify(value) : value}\n`
    );
  console.log(JSON.stringify(plan, null, 2));
}
