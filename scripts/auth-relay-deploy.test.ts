import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// Static guards for the staged auth relay rollout. The deploy only runs on main,
// so these catch wiring mistakes in a pull request instead of after the merge.
const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const workflow = parse(read('.github/workflows/deploy.yml'));
const action = parse(read('.github/actions/deploy-auth/action.yml'));
const inventory = JSON.parse(
  read('packages/infra/tofu/modules/inventory/inventory.tf.json')
).locals.inventory;
const steps: Array<Record<string, any>> = action.runs.steps;

const vaultAction = steps.find((step) =>
  String(step.uses ?? '').startsWith('hashicorp/vault-action')
)!;
const vaultExports = new Map<string, { path: string; key: string }>();
for (const line of String(vaultAction.with.secrets).split(/[;\n]/)) {
  const match = /^\s*(\S+)\s+(\S+)\s*\|\s*(\S+)\s*$/.exec(line);
  if (match) vaultExports.set(match[3], { path: match[1], key: match[2] });
}

function githubEnvWrites(): Set<string> {
  const names = new Set<string>();
  for (const step of steps)
    for (const match of String(step.run ?? '').matchAll(
      /echo "([A-Za-z_]+)=[^"]*" >> "\$GITHUB_ENV"/g
    ))
      names.add(match[1]);
  return names;
}

test('every env expression refers to a variable the workflow defines', () => {
  const defined = new Set([
    ...Object.keys(workflow.jobs.deploy.env),
    ...vaultExports.keys(),
    ...githubEnvWrites(),
    // Written as a multi-line heredoc-free block by the pin step.
    'TF_VAR_image',
    'TF_VAR_keycloak_image',
    'TF_VAR_tunnel_image',
  ]);
  const used = [
    ...JSON.stringify(action).matchAll(
      /\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)/g
    ),
  ].map((match) => match[1]);
  expect(used.length).toBeGreaterThan(0);
  for (const name of used) expect(defined.has(name)).toBe(true);
});

test('Vault action exports read keys that exist in the Vault inventory', () => {
  const declared = new Map<string, string[]>(
    inventory.vault.kv_keys.map((key: { name: string; configs: string[] }) => [
      key.name,
      key.configs,
    ])
  );
  for (const { path, key } of vaultExports.values()) {
    const config = path.split('/').pop()!;
    expect(declared.get(key)?.includes(config) ?? false).toBe(true);
  }
});

test('each realm apply gets the variables the auth root declares, from its own Vault config', () => {
  const declared = [
    ...read('packages/infra/tofu/auth/main.tf').matchAll(
      /^variable "([a-z_]+)"/gm
    ),
  ].map((match) => match[1]);
  for (const instance of ['production', 'nonproduction']) {
    const config = inventory.auth_relay.instances[instance].vault_config;
    const applies = steps.filter(
      (step) =>
        step.uses === './.github/actions/tofu' &&
        step.with?.root === 'auth' &&
        step.with?.state_key === `auth-${instance}` &&
        step.with?.mode !== 'prepare'
    );
    // The first apply may fail once; a retry with a fresh login follows it.
    expect(applies.length).toBe(2);
    for (const step of applies) {
      expect(step.env.TF_VAR_instance).toBe(instance);
      for (const name of ['google_client_id', 'google_client_secret']) {
        expect(declared).toContain(name);
        const expression = String(step.env[`TF_VAR_${name}`]);
        const exported = /env\.([A-Z_]+)/.exec(expression)?.[1] ?? '';
        expect(vaultExports.get(exported)?.path.endsWith(`/${config}`)).toBe(
          true
        );
      }
    }
  }
});

test('the realm applies run after the Vault login and the stable admin API wait', () => {
  const index = (predicate: (step: Record<string, any>) => boolean) =>
    steps.findIndex(predicate);
  const login = index((step) =>
    String(step.uses ?? '').startsWith('hashicorp/vault-action')
  );
  const wait = index(
    (step) => step.name === 'Wait for the admin API through the tunnel'
  );
  const firstRealm = index(
    (step) => step.with?.root === 'auth' && step.with?.mode !== 'prepare'
  );
  expect(login).toBeGreaterThan(-1);
  expect(wait).toBeGreaterThan(login);
  expect(firstRealm).toBeGreaterThan(wait);
  const script = String(steps[wait].run);
  // The first 200 can come from the previous deployment during a rollout.
  expect(script).toContain('bun scripts/ci/auth-readiness.ts');
  expect(steps[wait].env.AUTH_HOSTING_CHANGES).toContain(
    'steps.hosting.outputs.changed_resources'
  );
  expect(steps[wait].env.AUTH_FOUNDATION_CHANGES).toContain(
    'inputs.foundation_changes'
  );
  expect(steps[wait].env.AUTH_FIRST_DEPLOYMENT).toContain(
    'env.FIRST_DEPLOYMENT'
  );
});

test('roots run with the CI Vault token never use the Vault provider while its role lacks lookup-self', () => {
  const policy = read('packages/vault-service/config/policies/ci-read.hcl');
  const allowsLookup = /path\s+"auth\/token\/lookup-self"/.test(policy);
  const files = (dir: string) =>
    readdirSync(join(root, dir))
      .filter((name) => name.endsWith('.tf'))
      .map((name) => read(`${dir}/${name}`))
      .join('\n');
  // The auth root never reads Vault through the provider; the Vault action does.
  expect(files('packages/infra/tofu/auth')).not.toMatch(
    /vault_|provider "vault"/
  );
  // The public gateway stage reads Vault through the provider in auth-hosting.
  if (inventory.auth_relay.live === true) expect(allowsLookup).toBe(true);
});

test('the identity service is a single replica until Railway replicas can cluster', () => {
  const hosting = read('packages/infra/tofu/auth-hosting/main.tf');
  expect(hosting).toMatch(
    /-identity", health_path = "\/health\/ready", railway = \{ replicas = 1 \}/
  );
  const dockerfile = read('packages/auth-relay/Dockerfile.keycloak');
  expect(dockerfile).toContain('ARG KC_CACHE=local');
});

test('the Vault provider in auth-hosting never creates a child token', () => {
  expect(read('packages/infra/tofu/auth-hosting/main.tf')).toMatch(
    /provider "vault" \{[\s\S]*?skip_child_token\s*=\s*true/
  );
});

test('the gateway waits for projected credentials and gets a fresh Vault login', () => {
  const index = (predicate: (step: Record<string, any>) => boolean) =>
    steps.findIndex(predicate);
  const hosting = (step: Record<string, any>) =>
    step.uses === './.github/actions/tofu' &&
    step.with?.root === 'auth-hosting' &&
    step.with?.mode !== 'prepare';
  const firstHosting = index(hosting);
  const lastHosting = steps.map(hosting).lastIndexOf(true);
  const vaultRoot = index(
    (step) =>
      step.uses === './.github/actions/tofu' && step.with?.root === 'vault'
  );
  expect(firstHosting).toBeGreaterThan(-1);
  expect(lastHosting).toBeGreaterThan(firstHosting);
  // No gateway (and so no Vault read) before the credentials are projected.
  const defer = steps.find(
    (step) =>
      step.name === 'Defer the gateway until its credentials are projected'
  )!;
  expect(index((step) => step === defer)).toBeLessThan(firstHosting);
  expect(String(defer.run)).toContain('TF_VAR_deploy_gateway=false');
  expect(String(defer.run)).toContain('TF_VAR_deploy_gateway=true');
  const repin = steps.find((step) =>
    String(step.name ?? '').startsWith('Re-pin Keycloak')
  )!;
  expect(String(repin.run)).toContain('TF_VAR_deploy_gateway=true');
  expect(vaultRoot).toBeLessThan(index((step) => step === repin));
  // The 15-minute CI token must be reissued after the vault root, right before
  // the gateway pass and the health check that read Vault.
  const logins = steps
    .map((step, position) => ({ step, position }))
    .filter(({ step }) =>
      String(step.uses ?? '').startsWith('hashicorp/vault-action')
    );
  expect(logins.length).toBe(2);
  expect(logins[1].position).toBeGreaterThan(vaultRoot);
  expect(logins[1].position).toBeLessThan(lastHosting);
});

test('the deploy waits for each public gateway before the health check', () => {
  const names = steps.map((step) => step.name);
  const wait = names.indexOf('Wait for the public gateways');
  expect(wait).toBeGreaterThan(-1);
  expect(wait).toBeLessThan(names.indexOf('Health'));
  expect(String(steps[wait].run)).toContain('/health/ready');
  expect(String(steps[wait].run)).toContain('streak');
});

test('the CI Vault role can describe its own token when the gateway is live', () => {
  expect(read('packages/vault-service/config/policies/ci-read.hcl')).toMatch(
    /path "auth\/token\/lookup-self" \{\s*capabilities = \["read"\]/
  );
});

test('staged auth populates Vault setup credentials before its health check', () => {
  const vault = steps.findIndex((step) => step.with?.root === 'vault');
  const health = steps.findIndex((step) => step.name === 'Health');
  expect(vault).toBeGreaterThan(-1);
  expect(steps[vault].if).toBeUndefined();
  expect(vault).toBeLessThan(health);
  const parentVault = workflow.jobs.deploy.steps.find(
    (step: { name?: string }) => step.name === 'Apply vault'
  );
  expect(parentVault.if).toContain("steps.plan.outputs.auth != 'true'");
});
