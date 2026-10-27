import { Abort } from '../vault-inputs/flow';
import type { Io } from './io';
import { googleCallbacks, poll, type Inventory } from './model';
import type { Store } from './store';

const MINUTE = 60_000;
export type Secrets = Readonly<Record<string, string>>;
export type Deps = {
  io: Io;
  inventory: Inventory;
  vault(config: string): Promise<Secrets | undefined>;
  store(url: string): Store;
};

function heading(io: Io, number: number, title: string) {
  io.say(`\n── ${number}. ${title}`);
}

async function relayReady(d: Deps, issuer: string, origin: string) {
  const { io } = d;
  heading(io, 2, 'Is the relay deployed?');
  const probe = async () => {
    const ready = await io.get(`${origin}/health/ready`);
    const discovery = await io.get(
      `${issuer}/.well-known/openid-configuration`
    );
    return ready?.status === 200 && discovery?.status === 200
      ? true
      : undefined;
  };
  const up = await poll(probe, {
    timeoutMs: 2 * MINUTE,
    intervalMs: 10_000,
    sleep: io.sleep,
  });
  if (!up)
    throw new Abort(
      `${origin} is not answering yet. Wait for the "Auth relay deploy" run on main to finish (it waits for this same endpoint), then re-run.`
    );
  io.say(`✓ ${origin} is ready and publishes ${issuer}`);
}

async function google(d: Deps) {
  const { io, inventory } = d;
  heading(io, 1, 'Allow the relay in the Google OAuth client');
  const callbacks = googleCallbacks(inventory);
  io.say(
    "Google only needs the relay's fixed broker callbacks, never the apps':"
  );
  for (const url of callbacks) io.say(`  ${url}`);
  const copied = await io.copy(callbacks.join('\n'));
  if (copied) io.say('(copied to your clipboard)');
  await io.open('https://console.cloud.google.com/apis/credentials');
  io.say(
    'Open the OAuth 2.0 web client → Authorised redirect URIs → add both → Save.'
  );
  if (
    !(await io.confirm('Both redirect URIs are on the Google client?', false))
  )
    throw new Abort('Add the redirect URIs, then re-run `bun run auth:setup`.');
}

async function operator(d: Deps, store: Store, origin: string, token: string) {
  const { io } = d;
  heading(io, 3, 'Claim operator access (once)');
  if ((await store.operatorCount()) > 0) {
    io.say('✓ An operator already exists; skipping the one-time claim.');
    return;
  }
  const copied = await io.copy(token);
  io.say(`Opening ${origin}`);
  io.say('  1. Continue with Google and sign in.');
  io.say(
    copied
      ? '  2. Paste the setup token (it is on your clipboard; it is not printed here).'
      : '  2. Enter the setup token from Vault: AUTH_RELAY_SETUP_TOKEN_PRODUCTION.'
  );
  await io.open(origin);
  const claimed = await poll(
    async () => ((await store.operatorCount()) > 0 ? true : undefined),
    { timeoutMs: 15 * MINUTE, intervalMs: 3_000, sleep: io.sleep }
  );
  if (!claimed) throw new Abort('No operator was claimed within 15 minutes.');
  io.say(
    '✓ Operator claimed. Add a second operator in the UI before launch (docs/operations).'
  );
}

export async function authSetup(d: Deps): Promise<void> {
  const relay = d.inventory.auth_relay.instances['production'];
  if (!relay)
    throw new Abort('No production authentication relay is configured.');
  const secrets = await d.vault(relay.vault_config);
  if (!secrets)
    throw new Abort(
      'Cannot read Vault. Run `bun run vault:login` and try again.'
    );
  const missing = [relay.setup_token_key, 'AUTH_RELAY_DATABASE_URL'].filter(
    (name) => !secrets[name]
  );
  if (missing.length)
    throw new Abort(
      `Vault is missing ${missing.join(', ')}. Run the authentication relay deploy first.`
    );
  const origin = `https://${relay.hostname}`;
  await google(d);
  await relayReady(d, `${origin}/realms/${relay.realm}`, origin);
  const store = d.store(secrets['AUTH_RELAY_DATABASE_URL']!);
  try {
    await operator(d, store, origin, secrets[relay.setup_token_key]!);
    d.io.say(
      'Authentication relay setup is complete. Register applications and exact callbacks through its management UI.'
    );
    await d.io.open(origin);
  } finally {
    await store.close();
  }
}
