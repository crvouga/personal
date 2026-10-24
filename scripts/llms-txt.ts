/**
 * Renders the repo-root `llms.txt`: the integration guide external codebases
 * (and their agents) fetch to consume Vault, the Turborepo remote cache, the R2
 * object store, and fleet hosting.
 *
 * Prose lives in `scripts/llms-txt.template.md`. Every value an integrator
 * copies — hostnames, Vault paths, OIDC role, buckets, key names, the publish
 * workflow, publisher inputs, the fleet — is read from its source of truth here, so
 * the file cannot drift. Template tokens:
 *
 *   {{name}}          scalar from `values()`
 *   {{block:name}}    multi-line block from `blocks()`
 *   {{path:p}}        repo file link; fails if `p` does not exist
 *   {{file:p}}        bare repo path (for code blocks); fails if missing
 *   {{script:name}}   `bun run name`; fails if not a root package.json script
 *
 * `bun run llms:sync` writes the file; `bun run check:llms` (`--check`) changes
 * nothing and exits 1 on drift.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  imagePrefix,
  infraGithubRepo,
  loadServicesConfig,
  serviceHealthPath,
  vaultAddr,
  type InfraConfig,
  type ServiceSpec,
} from '../packages/infra/lib/services.js';
import {
  PUBLISH_WORKFLOW_PATH,
  renderPublishWorkflow,
} from '../packages/infra/lib/publish-workflow.js';
import {
  TURBO_CLIENT_OPTIONAL_KEYS,
  TURBO_CLIENT_REQUIRED_KEYS,
  VAULT_SECRET_REGISTRY,
} from '../packages/turborepo-remote-cache/scripts/vault-secrets-registry.js';
import { OBJECT_KEY_PREFIX } from '../packages/object-store/src/object-key.js';
import { TOPIC_TO_IMAGE_SRC } from '../packages/portfolio/src/content/topic.js';

const ROOT = join(import.meta.dirname, '..');
const TEMPLATE_PATH = 'scripts/llms-txt.template.md';
const ROOT_OUTPUT_PATH = 'llms.txt';
const OUTPUT_PATHS = [
  ROOT_OUTPUT_PATH,
  'packages/portfolio/public/llms.txt',
  'packages/portfolio/public/llm.txt',
] as const;
const EXAMPLE_SERVICE_ID = 'my-app';
const APPLICATION_DATABASE_SECRET = 'DATABASE_URL';

type WorkflowInput = {
  description?: string;
  required?: boolean;
  type?: string;
  default?: unknown;
};

type PublishWorkflow = {
  on: {
    workflow_call: {
      inputs: Record<string, WorkflowInput>;
      secrets: Record<string, { description?: string }>;
    };
  };
};

type Context = {
  config: InfraConfig;
  publisher: PublishWorkflow;
  deploy: { on: { repository_dispatch: { types: string[] } } };
  scripts: Record<string, string>;
};

function fail(message: string): never {
  throw new Error(`llms.txt: ${message}`);
}

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null || value === '') {
    fail(`missing ${what}`);
  }
  return value;
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function code(value: string): string {
  return `\`${value}\``;
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): string {
  if (rows.length === 0) fail(`empty table (${headers.join(', ')})`);
  const line = (cells: readonly string[]) =>
    `| ${cells.map(cell).join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map((r) => {
      if (r.length !== headers.length) fail(`ragged table row: ${r.join(',')}`);
      return line(r);
    }),
  ].join('\n');
}

function registryHint(key: string): string {
  return VAULT_SECRET_REGISTRY.find((e) => e.key === key)?.hint ?? '';
}

function registrySeed(key: string): string | undefined {
  return VAULT_SECRET_REGISTRY.find((e) => e.key === key)?.seed();
}

function service(ctx: Context, id: string): ServiceSpec {
  return need(
    ctx.config.services.find((s) => s.id === id),
    `service "${id}" in OpenTofu inventory`
  );
}

function jwtRole(ctx: Context) {
  const jwt = need(ctx.config.vault?.auth?.jwt, 'vault.auth.jwt');
  return {
    path: jwt.path,
    role: need(jwt.roles[0], 'vault.auth.jwt.roles[0]'),
  };
}

function runtimeToken(ctx: Context) {
  return need(
    ctx.config.vault?.tokens?.find((t) => t.sink === 'vault_kv.VAULT_TOKEN'),
    'vault.tokens entry sinking VAULT_TOKEN'
  );
}

/** `path "…"` stanzas of an HCL policy, e.g. `secret/data/personal/*`. */
function policyPaths(ctx: Context, policy: string): string[] {
  const spec = need(
    ctx.config.vault?.policies?.find((p) => p.name === policy),
    `vault policy "${policy}"`
  );
  const paths = [...read(spec.file).matchAll(/^path "([^"]+)"/gm)].map(
    (m) => m[1]!
  );
  if (paths.length === 0) fail(`no paths in ${spec.file}`);
  return paths;
}

function oidcSecrets(ctx: Context, keys: readonly string[]): string {
  const { kv } = need(ctx.config.vault, 'vault');
  const path = `${kv.mount}/data/${kv.project}/prd`;
  const width = Math.max(...keys.map((k) => k.length));
  return keys
    .map((k, i) => {
      const sep = i === keys.length - 1 ? '' : ' ;';
      return `${path} ${k.padEnd(width)} | ${k}${sep}`;
    })
    .join('\n');
}

function values(ctx: Context): Record<string, string> {
  const { config, publisher, deploy } = ctx;
  const vault = need(config.vault, 'vault');
  const infraRepo = infraGithubRepo(config);
  const { path: jwtPath, role } = jwtRole(ctx);
  const token = runtimeToken(ctx);
  const turbo = service(ctx, 'turborepo');
  const portfolio = service(ctx, 'portfolio');
  const databaseSecret = need(
    vault.kv_keys?.find((key) => key.name === APPLICATION_DATABASE_SECRET),
    `vault.kv_keys entry for ${APPLICATION_DATABASE_SECRET}`
  );
  const platformDatabase = need(
    config.postgres?.projects?.find(
      (project) => project.purpose === 'openbao-storage'
    ),
    'postgres.projects OpenBao storage entry'
  );
  const org = need(config.github?.org, 'github.org');
  const dispatchSecret = 'DEPLOY_DISPATCH_TOKEN';
  for (const name of [dispatchSecret, 'CALLER_GITHUB_TOKEN']) {
    need(
      publisher.on.workflow_call.secrets[name],
      `publish.yml workflow_call secret ${name}`
    );
  }
  return {
    infraRepo,
    authProductionOrigin: `https://${need(config.auth_relay?.instances.production?.hostname, 'auth production hostname')}`,
    authNonproductionOrigin: `https://${need(config.auth_relay?.instances.nonproduction?.hostname, 'auth nonproduction hostname')}`,
    authProductionIssuer: `https://${need(config.auth_relay?.instances.production?.hostname, 'auth production hostname')}/realms/${need(config.auth_relay?.instances.production?.realm, 'auth production realm')}`,
    authNonproductionIssuer: `https://${need(config.auth_relay?.instances.nonproduction?.hostname, 'auth nonproduction hostname')}/realms/${need(config.auth_relay?.instances.nonproduction?.realm, 'auth nonproduction realm')}`,
    authStatus: need(config.auth_relay?.status, 'auth relay status'),
    rawUrl: `https://raw.githubusercontent.com/${infraRepo}/main/${ROOT_OUTPUT_PATH}`,
    siteGuideUrl: `https://${need(portfolio.hostname, 'portfolio hostname')}/llms.txt`,
    siteGuideAliasUrl: `https://${need(portfolio.hostname, 'portfolio hostname')}/llm.txt`,
    zone: config.zone,
    githubOrg: org,
    vaultAddr: vaultAddr(config),
    kvMount: vault.kv.mount,
    kvProject: vault.kv.project,
    kvConfigs: vault.kv.configs.map(code).join(', '),
    adminUser: need(
      vault.auth?.userpass?.users[0]?.username,
      'vault.auth.userpass.users[0]'
    ),
    ciReadPaths: policyPaths(ctx, role.policy).map(code).join(' and '),
    jwtPath,
    jwtRole: role.name,
    jwtPolicy: role.policy,
    jwtRefBinding: role.bound_ref
      ? `The role additionally requires ref \`${role.bound_ref}\`.`
      : 'The existing role permits branch and pull-request jobs in these repositories.',
    jwtTtl: need(role.ttl, 'jwt role ttl'),
    runtimeTokenPolicy: token.policy,
    runtimeTokenPeriod: token.period,
    databaseSecret: databaseSecret.name,
    platformDatabaseSecret: platformDatabase.secret_name,
    turboApi: `https://${need(turbo.hostname, 'turborepo hostname')}`,
    turboHealthPath: need(serviceHealthPath(turbo), 'turborepo health path'),
    objectKeyPrefix: OBJECT_KEY_PREFIX,
    railwayProject: config.railway.project,
    railwayRegion: config.railway.region,
    imagePrefix: imagePrefix(config),
    ghcrPattern: `ghcr.io/${config.image_owner}/${imagePrefix(config)}-<id>`,
    dispatchSecret,
    dispatchEvent: need(
      deploy.on.repository_dispatch.types[0],
      'deploy.yml repository_dispatch type'
    ),
    publishWorkflowPath: PUBLISH_WORKFLOW_PATH,
    portfolioTopics: Object.keys(TOPIC_TO_IMAGE_SRC)
      .map((topic) => code(topic))
      .join(', '),
  };
}

function exampleService(ctx: Context): Record<string, unknown> {
  const { config } = ctx;
  const example = {
    id: EXAMPLE_SERVICE_ID,
    kind: 'railway',
    hostname: `${EXAMPLE_SERVICE_ID}.${config.zone}`,
    github_repo: `${config.github?.org ?? config.image_owner}/${EXAMPLE_SERVICE_ID}`,
    source_code_url: `https://github.com/${config.github?.org ?? config.image_owner}/${EXAMPLE_SERVICE_ID}`,
    dockerfile: './Dockerfile',
    build_context: '.',
    port: 8080,
    health_check: true,
    health_path: '/health',
    env: { PORT: '8080' },
    secrets: [{ name: 'DATABASE_URL', source: 'vault' }],
  };
  // Every field in the example must be one the real fleet uses, so a renamed
  // OpenTofu inventory field breaks this check instead of silently misleading.
  const used = new Set(config.services.flatMap((s) => Object.keys(s)));
  for (const key of Object.keys(example)) {
    if (!used.has(key))
      fail(`example service field "${key}" is unused in OpenTofu inventory`);
  }
  return example;
}

function blocks(ctx: Context): Record<string, string> {
  const { config, publisher } = ctx;
  const vault = need(config.vault, 'vault');
  const v = values(ctx);
  const { role } = jwtRole(ctx);
  const s3 = need(config.object_stores?.[0], 'object_stores[0]');
  const s3Keys = [
    s3.endpoint_secret,
    s3.region_secret,
    s3.access_key_secret,
    s3.secret_key_secret,
    s3.bucket_secret,
  ];
  const turboKeys = [
    ...TURBO_CLIENT_REQUIRED_KEYS,
    ...TURBO_CLIENT_OPTIONAL_KEYS,
  ];
  const required = new Set<string>(TURBO_CLIENT_REQUIRED_KEYS);

  const fleet = config.services.filter(
    (s) => (s.kind ?? 'railway') === 'railway' && !s.standalone && s.hostname
  );

  return {
    resources: table(
      ['Resource', 'Endpoint', 'Auth'],
      [
        [
          'Vault (OpenBao)',
          code(v.vaultAddr!),
          `\`vault login\` locally; GitHub OIDC (role \`${role.name}\`) in CI; read token at runtime`,
        ],
        [
          'PostgreSQL',
          `via ${code(v.databaseSecret!)} (opaque connection URL)`,
          'connection URL from Vault; an app-specific allocation is required',
        ],
        [
          'Turborepo cache',
          code(v.turboApi!),
          '`Authorization: Bearer $TURBO_TOKEN`',
        ],
        [
          'Object store',
          `Cloudflare R2 (S3 API) via \`${s3.endpoint_secret}\``,
          `SigV4 with \`${s3.access_key_secret}\` / \`${s3.secret_key_secret}\``,
        ],
        [
          'Google sign-in',
          `${code(v.authProductionIssuer!)} / ${code(v.authNonproductionIssuer!)}`,
          'Public OIDC code + S256 PKCE; agent registration uses a scoped Vault credential (§6)',
        ],
        [
          'Hosting',
          `Railway project \`${config.railway.project}\` at \`*.${config.zone}\``,
          'Prebuilt GHCR image published by the shared workflow (§5)',
        ],
      ]
    ),
    kvKeys: table(
      ['Key', 'Configs', 'Used by', 'Required'],
      need(vault.kv_keys, 'vault.kv_keys').map((k) => [
        code(k.name),
        k.configs.join(', '),
        (k.used_by ?? []).join(', '),
        k.required ? 'yes' : '',
      ])
    ),
    vaultYaml: stringifyYaml({
      addr: v.vaultAddr,
      mount: vault.kv.mount,
      project: vault.kv.project,
      config: 'dev',
    }).trimEnd(),
    oidcExample: [
      'permissions:',
      '  id-token: write',
      '  contents: read',
      '',
      'steps:',
      '  - uses: hashicorp/vault-action@v4',
      '    with:',
      `      url: ${v.vaultAddr}`,
      '      method: jwt',
      `      path: ${v.jwtPath}`,
      `      role: ${role.name}`,
      `      jwtGithubAudience: ${v.vaultAddr}`,
      '      secrets: |',
      ...oidcSecrets(ctx, ['DATABASE_URL', 'SOME_KEY'])
        .split('\n')
        .map((l) => `        ${l}`),
    ].join('\n'),
    turboEnv: table(
      ['Var', 'Required', 'Default', 'Meaning'],
      turboKeys.map((k) => [
        code(k),
        required.has(k) ? 'yes' : 'optional',
        registrySeed(k) ? code(registrySeed(k)!) : '',
        k === 'TURBO_TOKEN'
          ? `${registryHint(k)} — from Vault, never committed`
          : registryHint(k),
      ])
    ),
    turboOidcSecrets: [
      'secrets: |',
      ...oidcSecrets(ctx, TURBO_CLIENT_REQUIRED_KEYS)
        .split('\n')
        .map((l) => `  ${l}`),
    ].join('\n'),
    buckets: table(
      ['Vault config', 'Bucket'],
      need(config.object_stores, 'object_stores').map((o) => [
        (o.namespaces ?? []).map(code).join(', '),
        code(need(o.bucket, `object_stores ${o.id} bucket`)),
      ])
    ),
    s3Env: table(
      ['Var', 'Meaning'],
      s3Keys.map((k) => [code(k), registryHint(k)])
    ),
    serviceExample: JSON.stringify(exampleService(ctx), null, 2),
    publishWorkflow: renderPublishWorkflow(
      [
        {
          id: EXAMPLE_SERVICE_ID,
          dockerfile: './Dockerfile',
          build_context: '.',
        },
      ],
      {
        infraRepo: v.infraRepo!,
        imagePrefix: imagePrefix(config),
        imageOwner: config.image_owner,
      }
    ).trimEnd(),
    workflowCallInputs: table(
      ['Input', 'Required', 'Default', 'Meaning'],
      Object.entries(publisher.on.workflow_call.inputs).map(([name, input]) => [
        code(name),
        input.required ? 'yes' : '',
        input.default === undefined ? '' : code(String(input.default)),
        input.description ?? '',
      ])
    ),
    fleet: table(
      [
        'Service id',
        'Public URL',
        'Repo',
        'Dockerfile (context)',
        'Port',
        'Health',
      ],
      fleet.map((s) => [
        code(s.id),
        `https://${s.hostname}`,
        s.source_code_url
          ? `[${s.github_repo}](${s.source_code_url})`
          : (s.github_repo ?? ''),
        s.image
          ? `external image ${code(s.image)}`
          : `${code(s.dockerfile ?? '')} (${code(s.build_context ?? '')})`,
        String(s.port ?? ''),
        code(serviceHealthPath(s) ?? 'none'),
      ])
    ),
  };
}

function render(ctx: Context): string {
  const vals = values(ctx);
  const blks = blocks(ctx);
  const infraRepo = vals.infraRepo!;
  const out = read(TEMPLATE_PATH).replace(
    /\{\{([a-z]+):([^}]+)\}\}|\{\{([A-Za-z]+)\}\}/g,
    (
      _,
      kind: string | undefined,
      arg: string | undefined,
      name: string | undefined
    ) => {
      if (name) return need(vals[name], `template value {{${name}}}`);
      const target = arg!.trim();
      switch (kind) {
        case 'block':
          return need(blks[target], `template block {{block:${target}}}`);
        case 'path':
        case 'file':
          if (!existsSync(join(ROOT, target)))
            fail(`referenced path ${target} does not exist`);
          return kind === 'file'
            ? target
            : `[\`${target}\`](https://github.com/${infraRepo}/blob/main/${target})`;
        case 'script':
          if (!(target in ctx.scripts))
            fail(
              `referenced script "bun run ${target}" is not in package.json`
            );
          return `bun run ${target}`;
        default:
          return fail(`unknown template token {{${kind}:${target}}}`);
      }
    }
  );
  // Also catches `{ { block:x } }`, the shape a formatter rewrites a token to.
  const leftover = out.replace(/\$\{\{[^}]*\}\}/g, '');
  if (/\{\{|\}\}|\{ \{ [a-z]+:/.test(leftover)) {
    fail('unresolved template token');
  }
  return `${out.trimEnd()}\n`;
}

export function renderLlmsTxt(): string {
  return render({
    config: loadServicesConfig(
      join(ROOT, 'packages/infra/tofu/modules/inventory/inventory.tf.json')
    ),
    publisher: parseYaml(
      read('.github/workflows/publish.yml')
    ) as PublishWorkflow,
    deploy: parseYaml(read('.github/workflows/deploy.yml')),
    scripts: (
      JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    ).scripts,
  });
}

if (import.meta.main) {
  const next = renderLlmsTxt();
  const outputs = OUTPUT_PATHS.map((outputPath) => {
    const path = join(ROOT, outputPath);
    return {
      outputPath,
      path,
      current: existsSync(path) ? readFileSync(path, 'utf8') : null,
    };
  });
  const stale = outputs.filter(({ current }) => current !== next);
  if (process.argv.includes('--check')) {
    if (stale.length > 0) {
      console.error(
        `${stale.map(({ outputPath }) => outputPath).join(', ')} out of date — run: bun run llms:sync`
      );
      process.exit(1);
    }
    console.log(`${OUTPUT_PATHS.length} llms.txt outputs are up to date`);
  } else if (stale.length === 0) {
    console.log(`${OUTPUT_PATHS.length} llms.txt outputs unchanged`);
  } else {
    for (const { outputPath, path } of stale) {
      writeFileSync(path, next);
      console.log(`wrote ${outputPath}`);
    }
  }
}
