import { configuration } from './config';
import { database } from './db';
import { provider } from './oidc';
import { application } from './app';
import { maintenance } from './maintenance';

const config = configuration();
const db = database(config);
const app = application({ config, db, oidc: await provider(config) });
const server = Bun.serve({
  hostname: config.developmentIdentity ? '127.0.0.1' : '0.0.0.0',
  port: Number(process.env['PORT'] ?? 8080),
  fetch: app.fetch,
});
let working = false;
const timer = setInterval(() => {
  if (working) return;
  working = true;
  void maintenance({ config, db })
    .catch(() =>
      console.error('Auth relay cleanup failed; retrying next interval')
    )
    .finally(() => {
      working = false;
    });
}, 60000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  const deadline = setTimeout(() => process.exit(1), 25000);
  await server.stop(false);
  await db.close();
  clearTimeout(deadline);
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
