// Turns an env file into the OpenTofu `secrets` input of the vault root. It
// only writes an ignored tfvars file (blank values are skipped); OpenTofu stays the sole writer of Vault.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const inventoryPath = join(
  repo,
  'packages/infra/tofu/modules/inventory/inventory.tf.json'
);
export const outputPath = join(
  repo,
  'packages/infra/tofu/vault/secrets.auto.tfvars.json'
);
const configs = ['dev', 'prd'] as const;
// Fields vault/main.tf computes, so an env value is overridden or meaningless.
const derived = new Set([
  'TURBO_API',
  'TURBO_TEAM',
  'TURBO_CACHE',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'VAULT_TOKEN',
  'DATABASE_URL',
  'CLOUDFLARE_ACCOUNT_ID',
  'INITIAL_PASSWORD',
  'JWT_SECRET',
  'API_KEY_SECRET',
  'MACHINE_ID_SALT',
]);
export const isDerived = (name: string) =>
  derived.has(name) || /^AUTH_(RELAY|CONSOLE|MANAGER)_/.test(name);
// Optional overrides of generated values, kept to preserve existing credentials.
export const overridable = (name: string) => name.startsWith('9ROUTER_');

export type KvKey = {
  name: string;
  configs: string[];
  required?: boolean;
  generated?: boolean;
};

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Line ${index + 1} is not KEY=VALUE`);
    const [, name, rest] = match as unknown as [string, string, string];
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, 1);
      if (end < 0) throw new Error(`Line ${index + 1}: unterminated quote`);
      const body = rest.slice(1, end);
      values[name] =
        quote === '"'
          ? body.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1')
          : body;
    } else values[name] = rest.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

export function buildTfvars(values: Record<string, string>) {
  const entries = Object.entries(values).filter(([, value]) => value.trim());
  return {
    secrets: Object.fromEntries(
      configs.map((c) => [c, Object.fromEntries(entries)])
    ),
  };
}

export function audit(values: Record<string, string>, keys: KvKey[]) {
  const generated = keys.filter((k) => k.generated).map((k) => k.name);
  return {
    ignored: Object.keys(values).filter(
      (name) => generated.includes(name) || isDerived(name)
    ),
    missing: keys
      .filter((k) => k.required && !k.generated)
      .map((k) => k.name)
      .filter((name) => !isDerived(name) && !overridable(name))
      .filter((name) => !values[name]?.trim()),
  };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: bun run vault:secrets <env-file>');
    process.exit(2);
  }
  const values = parseEnv(readFileSync(file, 'utf8'));
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const { ignored, missing } = audit(
    values,
    inventory.locals.inventory.vault.kv_keys
  );
  writeFileSync(
    outputPath,
    `${JSON.stringify(buildTfvars(values), null, 2)}\n`,
    { mode: 0o600 }
  );
  console.log(
    `Wrote ${Object.keys(values).length} keys for dev and prd to ${outputPath}`
  );
  if (ignored.length)
    console.warn(`OpenTofu generates and overrides: ${ignored.join(', ')}`);
  if (missing.length)
    console.warn(`Required inputs missing from ${file}: ${missing.join(', ')}`);
  console.log(
    'The map must be COMPLETE: omitted fields are removed from Vault. Review with:\n  bun run infra:vault plan -out=vault.tfplan'
  );
}
