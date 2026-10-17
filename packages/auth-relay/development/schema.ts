import { join } from 'node:path';
import { command } from './process';

const bootstrap = new Set([
  'postgresql_schema.console',
  'postgresql_database.scratch',
  'postgresql_schema.scratch',
]);
const resources = new Set([
  ...bootstrap,
  'atlas_schema.console',
  'keycloak_realm.broker',
  'keycloak_oidc_identity_provider.mock',
  'keycloak_openid_client.console',
  'keycloak_openid_client.manager',
  'keycloak_openid_client_service_account_role.registration',
]);
interface Change {
  address: string;
  mode: string;
  change: { actions: string[] };
}

export async function prepareSchema(
  root: string,
  cache: string,
  env: NodeJS.ProcessEnv
): Promise<Record<string, string>> {
  const prefix = [
    'tofu',
    `-chdir=${join(root, 'packages/infra/tofu/auth-development')}`,
  ];
  await command(
    [
      ...prefix,
      'init',
      '-input=false',
      '-lockfile=readonly',
      '-reconfigure',
      `-backend-config=path=${join(cache, 'state.tfstate')}`,
    ],
    env
  );
  await apply(prefix, cache, env, true);
  await apply(prefix, cache, env, false);
  const outputs = JSON.parse(
    await command(
      [...prefix, 'output', '-json', 'development_environment'],
      env,
      true
    )
  ) as Record<string, string>;
  return outputs;
}
async function apply(
  prefix: string[],
  cache: string,
  env: NodeJS.ProcessEnv,
  initial: boolean
): Promise<void> {
  const plan = join(cache, initial ? 'schema.tfplan' : 'application.tfplan');
  const targets = initial
    ? [...bootstrap].map((address) => `-target=${address}`)
    : [];
  await command(
    [...prefix, 'plan', '-input=false', `-out=${plan}`, ...targets],
    env
  );
  const report = JSON.parse(
    await command([...prefix, 'show', '-json', plan], env, true)
  ) as { resource_changes?: Change[] };
  validatePlan(report.resource_changes ?? [], initial);
  process.stdout.write(
    'Reviewed local-only plan: owned resources, no deletions.\n'
  );
  await command([...prefix, 'apply', '-input=false', plan], env);
}

export function validatePlan(changes: Change[], initial = false): void {
  for (const resource of changes) {
    if (resource.mode === 'data') continue;
    if (
      !resources.has(resource.address) ||
      resource.change.actions.some(
        (action) => !['create', 'update', 'no-op'].includes(action)
      )
    )
      throw new Error('Unsafe local development plan rejected');
    if (
      initial &&
      !bootstrap.has(resource.address) &&
      resource.change.actions.some((action) => action !== 'no-op')
    )
      throw new Error('Schema bootstrap touched unrelated resources');
  }
}
