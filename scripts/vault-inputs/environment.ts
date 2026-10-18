// Gathers the foundation root's provider inputs: from the environment, from an
// optional env file, from `gh` when it can supply them, else by prompting.
// Nothing is written to disk; values live only in the child-process env.
import { ask, askSecret, confirm } from './prompt';
import { capture } from './process';

type InputSpec = {
  variable: string;
  label: string;
  secret: boolean;
  /** Also exported under these names (the S3 state backend reads AWS_*). */
  alsoAs?: string[];
  fromGh?: string[];
  /** Field of the live prd Vault document holding the same credential. */
  fromVault?: string;
};

const INPUTS: InputSpec[] = [
  {
    variable: 'cloudflare_account_id',
    label: 'Cloudflare account ID',
    secret: false,
    fromGh: ['variable', 'get', 'CLOUDFLARE_ACCOUNT_ID'],
  },
  {
    variable: 'cloudflare_zone_id',
    label: 'Cloudflare zone ID',
    secret: false,
    fromGh: ['variable', 'get', 'CLOUDFLARE_ZONE_ID'],
  },
  {
    variable: 'state_passphrase',
    label: 'OpenTofu state passphrase (32+ chars)',
    secret: true,
  },
  {
    variable: 'state_access_key',
    label: 'R2 state access key ID',
    secret: true,
    alsoAs: ['AWS_ACCESS_KEY_ID'],
  },
  {
    variable: 'state_secret_key',
    label: 'R2 state secret access key',
    secret: true,
    alsoAs: ['AWS_SECRET_ACCESS_KEY'],
  },
  {
    variable: 'cloudflare_api_token',
    label: 'Cloudflare API token',
    secret: true,
    fromVault: 'CLOUDFLARE_API_TOKEN',
  },
  {
    variable: 'railway_token',
    label: 'Railway account token',
    secret: true,
    fromVault: 'RAILWAY_TOKEN',
  },
  {
    variable: 'planetscale_service_token_id',
    label: 'PlanetScale service token ID',
    secret: true,
    fromVault: 'PLANETSCALE_SERVICE_TOKEN_ID',
  },
  {
    variable: 'planetscale_service_token',
    label: 'PlanetScale service token',
    secret: true,
    fromVault: 'PLANETSCALE_SERVICE_TOKEN',
  },
  {
    variable: 'github_token',
    label: 'GitHub PAT (repo, Actions, workflow)',
    secret: true,
  },
];

// The three state credentials are bootstrap trust anchors that GitHub will not
// hand back (Actions secrets are write-only), so they are typed once and kept in
// the macOS Keychain, readable only by this user, for later runs.
const KEYCHAIN_SERVICE = 'crvouga-vault-fix';
const keychain = process.platform === 'darwin';

const fromKeychain = (variable: string) =>
  keychain
    ? capture([
        'security',
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        variable,
        '-w',
      ])
    : Promise.resolve(undefined);

async function saveToKeychain(spec: InputSpec, value: string): Promise<void> {
  if (!keychain || !spec.secret || spec.fromVault) return;
  if (spec.variable === 'github_token') return;
  if (!(await confirm(`Remember ${spec.variable} in the macOS Keychain?`)))
    return;
  // -w takes the value on argv; `security -i` reads the command from stdin instead.
  const child = Bun.spawn({
    cmd: ['security', '-i'],
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'inherit',
  });
  child.stdin.write(
    `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${spec.variable} -w ${JSON.stringify(value)}\n`
  );
  child.stdin.end();
  if ((await child.exited) !== 0)
    console.log('Could not save to the Keychain.');
}

async function resolve(
  spec: InputSpec,
  given: Record<string, string>,
  live: Record<string, string>
): Promise<string> {
  const key = `TF_VAR_${spec.variable}`;
  const known = process.env[key] || given[key];
  if (known) return known;
  const fromGh = spec.fromGh && (await capture(['gh', ...spec.fromGh]));
  if (fromGh) return fromGh;
  const fromVault = spec.fromVault && live[spec.fromVault];
  if (fromVault) return fromVault;
  const remembered = await fromKeychain(spec.variable);
  if (remembered) return remembered;
  if (spec.variable === 'github_token') {
    const token = await capture(['gh', 'auth', 'token']);
    if (token && (await confirm('Use your `gh` login as the GitHub PAT?')))
      return token;
  }
  const prompt = spec.secret ? askSecret : ask;
  for (;;) {
    const value = await prompt(spec.label);
    if (value) {
      await saveToKeychain(spec, value);
      return value;
    }
    console.log('A value is required.');
  }
}

/** The env for every foundation tofu command. */
export async function collectEnvironment(
  given: Record<string, string>,
  live: Record<string, string>
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const spec of INPUTS) {
    const value = await resolve(spec, given, live);
    env[`TF_VAR_${spec.variable}`] = value;
    for (const alias of spec.alsoAs ?? []) env[alias] = value;
  }
  return env;
}
