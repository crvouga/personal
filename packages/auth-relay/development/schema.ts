import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { command } from './process';

const ATLAS = 'atlas_schema.console[0]';
const resources = new Set([
  'postgresql_schema.console',
  'postgresql_database.scratch',
  'postgresql_schema.scratch',
  ATLAS,
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
  if (!(await scaffolded(prefix, cache, env)))
    await apply(prefix, cache, env, false);
  await apply(prefix, cache, env, true);
  const outputs = JSON.parse(
    await command(
      [...prefix, 'output', '-json', 'development_environment'],
      env,
      true
    )
  ) as Record<string, string>;
  return outputs;
}
async function scaffolded(
  prefix: string[],
  cache: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (!existsSync(join(cache, 'state.tfstate'))) return false;
  const state = await command([...prefix, 'state', 'list'], env, true);
  return state.split('\n').includes('postgresql_schema.scratch');
}
async function apply(
  prefix: string[],
  cache: string,
  env: NodeJS.ProcessEnv,
  atlas: boolean
): Promise<void> {
  const plan = join(cache, atlas ? 'application.tfplan' : 'schema.tfplan');
  const flags = ['-input=false', '-compact-warnings'];
  await command(
    [
      ...prefix,
      'plan',
      ...flags,
      `-var=atlas_enabled=${String(atlas)}`,
      `-out=${plan}`,
    ],
    env
  );
  const report = JSON.parse(
    await command([...prefix, 'show', '-json', plan], env, true)
  ) as { resource_changes?: Change[] };
  validatePlan(report.resource_changes ?? [], atlas);
  process.stdout.write(
    'Reviewed local-only plan: owned resources, no deletions.\n'
  );
  await command([...prefix, 'apply', ...flags, plan], env);
}

export function validatePlan(changes: Change[], atlas = true): void {
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
      !atlas &&
      resource.address === ATLAS &&
      resource.change.actions.some((action) => action !== 'no-op')
    )
      throw new Error('Schema scaffolding must not apply the Atlas schema');
  }
}
