// `bun run auth:setup`: walks the human-only parts of putting Fleet behind the
// shared auth relay, and does everything around them. Each step looks at live
// state first, so a finished step is skipped and the command can be re-run.
import { Abort } from '../vault-inputs/flow';
import type { Io } from './io';
import {
  FLEET_SERVICE,
  configuredEnv,
  fleetEnv,
  fleetRegistration,
  fleetSignInAvailable,
  googleCallbacks,
  poll,
  withServiceEnv,
  type Inventory,
} from './model';
import type { Store } from './store';

const MINUTE = 60_000;
export type Secrets = Readonly<Record<string, string>>;
export type Deps = {
  io: Io;
  inventory: Inventory;
  /** Current inventory text, and a writer for the updated one. */
  inventoryText: string;
  writeInventory(text: string): void;
  vault(config: string): Promise<Secrets | undefined>;
  store(urls: { relay: string; fleet: string }): Store;
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

async function registerFleet(
  d: Deps,
  store: Store,
  origin: string,
  reg: ReturnType<typeof fleetRegistration>
) {
  const { io } = d;
  heading(io, 4, 'Register Fleet in the relay');
  const existing = await store.fleetClient();
  if (existing) {
    io.say(`✓ Fleet is already registered as ${existing.id}.`);
    return existing;
  }
  io.say(`In ${origin}, create a registration with exactly:`);
  io.say(`  Project      ${reg.project}`);
  io.say(`  Environment  ${reg.environment}`);
  io.say(`  Instance     ${reg.instance}`);
  io.say(`  Name         ${reg.name}`);
  io.say(`  Callback     ${reg.callback}`);
  io.say(
    `  Expires      ${reg.expires}   (production leases last at most 366 days)`
  );
  io.say('Confirm you own the fleet.chrisvouga.dev deployment, then Save.');
  await io.copy(reg.callback);
  const found = await poll(() => store.fleetClient(), {
    timeoutMs: 20 * MINUTE,
    intervalMs: 3_000,
    sleep: io.sleep,
  });
  if (!found)
    throw new Abort('No Fleet registration appeared within 20 minutes.');
  io.say(`✓ Found client ${found.id}.`);
  return found;
}

async function accessList(d: Deps, store: Store) {
  const { io } = d;
  heading(io, 5, 'Allow your email in Fleet');
  const count = await store.allowedEmails();
  io.say(
    count > 0
      ? `Fleet allows ${count} email address(es) today.`
      : 'Fleet allows nobody yet; access is never granted automatically.'
  );
  if (
    !(await io.confirm(
      'Add an email address to the Fleet access list?',
      count === 0
    ))
  )
    return;
  const email = (
    await io.ask('Google account email', await io.gitEmail())
  ).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Abort(`"${email}" is not an email address.`);
  await store.allowEmail(email);
  io.say(`✓ ${email} can sign in to Fleet.`);
}

function wire(
  d: Deps,
  reg: ReturnType<typeof fleetRegistration>,
  clientId: string
) {
  const { io } = d;
  heading(io, 6, 'Point Fleet at the relay');
  const want = fleetEnv(reg, clientId);
  const have = configuredEnv(d.inventory);
  if (Object.entries(want).every(([key, value]) => have[key] === value)) {
    io.say(
      `✓ ${FLEET_SERVICE} already has the relay settings in the inventory.`
    );
    return false;
  }
  d.writeInventory(withServiceEnv(d.inventoryText, FLEET_SERVICE, want));
  io.say(`✓ Added to the ${FLEET_SERVICE} env in the OpenTofu inventory:`);
  for (const [key, value] of Object.entries(want))
    io.say(`    ${key}=${value}`);
  io.say('  These are public identifiers, not secrets.');
  return true;
}

async function verify(
  d: Deps,
  reg: ReturnType<typeof fleetRegistration>,
  changed: boolean
) {
  const { io } = d;
  heading(io, 7, 'Check the live Fleet sign-in page');
  const page = await io.get(`${reg.origin}/login`);
  if (page && fleetSignInAvailable(page.body)) {
    io.say(`✓ ${reg.origin}/login offers Continue with Google.`);
    return;
  }
  io.say(`✗ ${reg.origin}/login still says Google sign-in is unavailable.`);
  io.say(
    changed
      ? '  Expected until the inventory change is merged and the Fleet deploy finishes.'
      : '  The inventory is already set, so check the Fleet deploy and its FLEET_OIDC_* variables.'
  );
}

export async function authSetup(d: Deps): Promise<void> {
  const { io } = d;
  const reg = fleetRegistration(d.inventory, io.now());
  const secrets = await d.vault(reg.relay.vault_config);
  const fleetSecrets = await d.vault('prd');
  if (!secrets || !fleetSecrets)
    throw new Abort(
      'Cannot read Vault. Run `bun run vault:login` and try again.'
    );
  const names = [reg.relay.setup_token_key, 'AUTH_RELAY_DATABASE_URL'];
  const missing = names.filter((name) => !secrets[name]);
  if (!fleetSecrets['DATABASE_URL']) missing.push('DATABASE_URL');
  if (missing.length)
    throw new Abort(
      `Vault is missing ${missing.join(', ')}. Run the Auth relay deploy first.`
    );

  const origin = `https://${reg.relay.hostname}`;
  await google(d);
  await relayReady(d, reg.issuer, origin);
  const store = d.store({
    relay: secrets['AUTH_RELAY_DATABASE_URL']!,
    fleet: fleetSecrets['DATABASE_URL']!,
  });
  try {
    await operator(d, store, origin, secrets[reg.relay.setup_token_key]!);
    const client = await registerFleet(d, store, origin, reg);
    await accessList(d, store);
    const changed = wire(d, reg, client.id);
    if (client.expiresAt)
      io.say(
        `\nRenew the Fleet registration before ${client.expiresAt.slice(0, 10)}, or sign-in stops.`
      );
    await verify(d, reg, changed);
    if (changed)
      io.say(
        '\nNext: commit the inventory change and merge it (`/pr-ready`). The deploy applies it; then re-run this command to verify.'
      );
  } finally {
    await store.close();
  }
}
