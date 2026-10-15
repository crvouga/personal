/**
 * Boots the dashboard on a local port with an in-memory store full of
 * realistic nodes. No database, no login. `bun run demo`, then open the URL.
 */
import { Hono } from 'hono';

import { mountUi } from '../src/routes/ui';
import { DEMO_LATEST, seedDemo } from '../src/testing/demo-data';
import { createFakeAuth } from '../src/testing/fake-auth';
import { MemoryStore } from '../src/testing/memory-store';
import type { AppDeps } from '../src/deps';

const port = Number(process.env['PORT'] ?? 4300);
let clock = new Date();
const store = new MemoryStore(() => clock);

const deps: AppDeps = {
  store,
  auth: createFakeAuth({ alwaysSignedInAs: 'chris' }),
  revisions: { latest: async () => DEMO_LATEST },
  env: {
    adminToken: 'demo',
    sessionSecret: 'demo',
    roleTokenHashes: {},
    vaultAddr: null,
    githubRepo: 'crvouga/workspace',
  },
  now: () => new Date(),
};

const empty = process.argv.includes('--empty');
if (!empty) seedDemo(store, new Date(), (at) => (clock = at));

const app = new Hono();
mountUi(app, deps);
Bun.serve({ port, fetch: app.fetch });
process.stdout.write(
  `Fleet dashboard demo: http://localhost:${port}${empty ? ' (empty)' : ''}\n`
);
