import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { password } from '@inquirer/prompts';
import { problemsFor } from '../packages/infra/lib/health/secret-rules';
import { TofuSession } from './secrets/session';
import { updateInputs } from './secrets/model';
import { ui } from './secrets/ui';
import type { Inventory } from './secrets/types';
import { cancel, cancellation } from './secrets/cancel';

const help = `Usage: bun run observability:bootstrap [--token-file <path>] [--stack <slug>] [--yes] [--dry-run]

Turns on the shared Grafana Cloud stack from one Grafana Cloud access policy
token, the only value that cannot be created as code. It:
  1. checks the token's scopes against the Grafana Cloud API,
  2. finds the stack to adopt (or plans to create one) and records its slug and
     region in the OpenTofu inventory,
  3. stores the token in Vault prd and the GitHub Actions secret through saved,
     reviewed OpenTofu plans,
  4. sets observability.live and regenerates the agent guides.
Merging the resulting change lets Deploy create everything else.

  --token-file  Read the token from a file (default: GRAFANA_CLOUD_ACCESS_POLICY_TOKEN, then a hidden prompt)
  --stack       Stack slug to adopt when the organization has several
  --yes         Apply the reviewed plans without asking
  --dry-run     Preview the plans; change nothing

Create the token at grafana.com → Administration → Cloud access policies with
realm = your organization and scopes ${'`'}stacks:read stacks:write
accesspolicies:read accesspolicies:write accesspolicies:delete
stack-service-accounts:write${'`'}. Requires an administrator Vault CLI login.
`;

const KEY = 'GRAFANA_CLOUD_ACCESS_POLICY_TOKEN';
const API = 'https://grafana.com/api';
const inventoryPath = resolve(
  import.meta.dirname,
  '../packages/infra/tofu/modules/inventory/inventory.tf.json'
);

export type CloudStack = {
  slug: string;
  name: string;
  regionSlug: string;
  status: string;
};
export type StackChoice = {
  slug: string;
  name: string;
  region: string;
  adopt: boolean;
};

/** Adopt the inventory's stack, the only one, or a named one; create when there is none. */
export function chooseStack(
  stacks: readonly CloudStack[],
  wanted: StackChoice,
  requested?: string
): StackChoice {
  const slug = requested ?? wanted.slug;
  const named = stacks.find((stack) => stack.slug === slug);
  const found =
    named ??
    (requested === undefined && stacks.length === 1 ? stacks[0] : undefined);
  if (found)
    return {
      slug: found.slug,
      name: found.name,
      region: found.regionSlug,
      adopt: true,
    };
  if (requested !== undefined || stacks.length > 1)
    throw new Error(
      `No stack "${slug}" in this organization. Pass --stack with one of: ${stacks.map((stack) => stack.slug).join(', ')}.`
    );
  return { ...wanted, adopt: false };
}

/** Rewrite only the observability block, keeping the rest of the file byte for byte. */
export function updateInventory(text: string, stack: StackChoice): string {
  const start = text.indexOf('"observability": {');
  const end = text.indexOf('"synthetic_monitoring"', start);
  if (start < 0 || end < 0)
    throw new Error('The inventory has no observability block to update.');
  let block = text.slice(start, end);
  const set = (pattern: RegExp, value: string) => {
    if (!pattern.test(block))
      throw new Error(`The observability block has no ${pattern.source}.`);
    block = block.replace(pattern, (_, key) => `${key}${value}`);
  };
  set(/("live": )(true|false)/, 'true');
  set(/("slug": )"[^"]*"/, JSON.stringify(stack.slug));
  set(/("name": )"[^"]*"/, JSON.stringify(stack.name));
  set(/("region": )"[^"]*"/, JSON.stringify(stack.region));
  set(/("adopt": )(true|false)/, String(stack.adopt));
  return text.slice(0, start) + block + text.slice(end);
}

async function cloud(token: string, path: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as unknown,
  };
}

async function verifyToken(
  token: string,
  region: string
): Promise<CloudStack[]> {
  const instances = await cloud(token, '/instances');
  if (instances.status === 401)
    throw new Error(
      'Grafana Cloud rejected the token. Create a new one and retry.'
    );
  if (instances.status !== 200)
    throw new Error(
      `GET /api/instances answered ${instances.status}; the token needs the stacks:read scope.`
    );
  const stacks = (
    (instances.body as { items?: CloudStack[] })?.items ?? []
  ).filter((stack) => stack.status !== 'deleted');
  const policies = await cloud(
    token,
    `/v1/accesspolicies?region=${encodeURIComponent(region)}`
  );
  if (policies.status !== 200)
    throw new Error(
      `GET /api/v1/accesspolicies answered ${policies.status}; the token needs the accesspolicies:read and accesspolicies:write scopes.`
    );
  return stacks;
}

type Options = {
  'token-file'?: string;
  stack?: string;
  yes?: boolean;
  'dry-run'?: boolean;
  help?: boolean;
};

async function readToken(options: Options): Promise<string> {
  if (options['token-file'])
    return readFileSync(options['token-file'], 'utf8').trim();
  const env = process.env[KEY]?.trim();
  if (env) return env;
  if (!process.stdin.isTTY)
    throw new Error(
      `Pass --token-file or set ${KEY}; no terminal to prompt in.`
    );
  return (
    await password(
      { message: `${KEY} (hidden)`, mask: '*' },
      { signal: cancellation.signal }
    )
  ).trim();
}

async function main() {
  const options: Options = parseArgs({
    options: {
      'token-file': { type: 'string' },
      stack: { type: 'string' },
      yes: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  }).values;
  if (options.help) {
    console.log(help);
    return;
  }
  const dryRun = options['dry-run'] === true;
  const text = readFileSync(inventoryPath, 'utf8');
  const inventory = JSON.parse(text).locals.inventory as Inventory & {
    observability: { stack: StackChoice };
  };

  const token = await readToken(options);
  const problem = problemsFor(KEY, token).find((p) => p.severity === 'fail');
  if (!token || problem)
    throw new Error(`${KEY} ${problem?.message ?? 'is empty'}.`);

  const wanted = inventory.observability.stack;
  const stacks = await verifyToken(token, wanted.region);
  const stack = chooseStack(stacks, wanted, options.stack);
  console.log(
    stack.adopt
      ? `✓ Token accepted. Adopting stack ${stack.slug} (${stack.region}).`
      : `✓ Token accepted. No stack yet; Deploy will create ${stack.slug} (${stack.region}).`
  );

  const session = new TofuSession(inventory, {
    ...ui,
    confirm: (message, fallback) =>
      options.yes ? Promise.resolve(true) : ui.confirm(message, fallback),
  });
  try {
    const before = await session.load();
    if (before.secrets.prd[KEY] === token)
      console.log(`✓ ${KEY} is already stored.`);
    else {
      const fills = [{ config: 'prd' as const, name: KEY, value: token }];
      await session.update(
        before,
        updateInputs(before, fills, inventory.vault.kv_keys),
        fills,
        dryRun
      );
    }
  } finally {
    session.close();
  }
  if (dryRun) {
    console.log('\nPreview complete. Nothing changed.');
    return;
  }

  writeFileSync(inventoryPath, updateInventory(text, stack));
  const sync = Bun.spawnSync(['bun', 'run', 'llms:sync'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (sync.exitCode !== 0) throw new Error('bun run llms:sync failed.');
  console.log(`
✓ observability.live is on in the inventory.
Next: open a PR with this change. Deploy then applies foundation (stack, tokens,
synthetic monitoring) and vault (OTEL_* and GRAFANA_* keys). Afterwards run
  bun run health --only observability`);
}

if (import.meta.main) {
  process.on('SIGINT', cancel);
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
