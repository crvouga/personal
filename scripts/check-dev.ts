/** Opt-in real cold/warm workspace acceptance, isolated from normal auth data. */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { localIdentity } from '../packages/auth-relay/development/identity';
import { checkDevBrowser } from './check-dev-browser';

const root = resolve(import.meta.dir, '..');
const instance = `check-${crypto.randomUUID().replaceAll('-', '')}`;
const { cache, project } = localIdentity(root, instance);
await mkdir(dirname(cache), { recursive: true });
// Exclusive ownership is established before any cleanup becomes possible.
await mkdir(cache, { mode: 0o700 });
const logDir = join(root, '.superset/.dev-check', instance);
await mkdir(logDir, { recursive: true });
const ports: number[] = [];
while (ports.length < 4) {
  const probe = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  if (probe.port && probe.port < 65000 && !ports.includes(probe.port))
    ports.push(probe.port);
  probe.stop(true);
}
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AUTH_'))
  ),
  AUTH_DEV_INSTANCE: instance,
  AUTH_DEV_MODE: 'local',
  VAULT_CONFIG: 'dev',
  PORTFOLIO_PORT: String(ports[0]),
  AUTH_RELAY_PORT: String(ports[2]),
};
let task: Bun.Subprocess | undefined;
let round = 0;
async function start(): Promise<void> {
  round++;
  const path = join(logDir, `run-${round}.log`);
  const descriptor = openSync(path, 'w', 0o600);
  try {
    task = Bun.spawn(['bun', 'run', 'dev'], {
      cwd: root,
      env,
      detached: true,
      stdin: 'ignore',
      stdout: descriptor,
      stderr: descriptor,
    });
  } finally {
    closeSync(descriptor);
  }
  console.log(`Workspace run ${round}: ${path}`);
}
async function stop(): Promise<void> {
  if (!task) return;
  try {
    // Signal the supervisor once. Signalling its whole group also hits the
    // Turbo wrapper and native child, turning the duplicate into a forced exit.
    process.kill(task.pid, 'SIGTERM');
  } catch {
    /* already exited */
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let running = true;
    try {
      process.kill(-task.pid, 0);
    } catch {
      running = false;
    }
    if (!running && !(await Bun.file(join(cache, 'instance.pid')).exists())) {
      task = undefined;
      return;
    }
    await Bun.sleep(200);
  }
  try {
    process.kill(-task.pid, 'SIGKILL');
  } catch {
    /* already exited */
  }
  await task.exited;
  task = undefined;
  throw new Error('Workspace did not shut down gracefully within 30 seconds');
}
async function response(
  port: number,
  path: string,
  expected = 200
): Promise<string> {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const log = await readFile(join(logDir, `run-${round}.log`), 'utf8');
    if (/error: script "dev" exited with code [1-9]/.test(log))
      throw new Error(`A dev task failed; see ${logDir}`);
    try {
      const result = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(15000),
      });
      const body = await result.text();
      if (result.status === expected) return body;
    } catch {
      /* dependency startup */
    }
    if (task?.exitCode !== null)
      throw new Error(`Workspace exited before ${port}${path} became ready`);
    await Bun.sleep(500);
  }
  throw new Error(`Readiness timeout on ${port}${path}; see ${logDir}`);
}
async function composeDown(): Promise<void> {
  const exists = await Bun.file(join(cache, 'ports.json')).exists();
  if (!exists) {
    await rm(cache, { recursive: true, force: true });
    return;
  }
  const mappings = JSON.parse(
    await readFile(join(cache, 'ports.json'), 'utf8')
  );
  const cleanup = Bun.spawn(
    [
      'docker',
      'compose',
      '-p',
      project,
      '-f',
      join(root, 'packages/auth-relay/development/compose.yml'),
      'down',
      '--volumes',
    ],
    {
      env: { ...env, ...mappings, AUTH_LOCAL_APP_PORT: env['AUTH_RELAY_PORT'] },
      stdout: 'inherit',
      stderr: 'inherit',
    }
  );
  const deadline = setTimeout(() => cleanup.kill('SIGKILL'), 30000);
  try {
    assert.equal(await cleanup.exited, 0, 'owned fixture cleanup failed');
  } finally {
    clearTimeout(deadline);
  }
  await rm(cache, { recursive: true, force: true });
}
try {
  await start();
  const [portfolio, relay] = await Promise.all([
    response(ports[0], '/'),
    response(ports[2], '/health/ready'),
  ]);
  assert.match(portfolio, /Live data from the GitHub API at build time/);
  assert.deepEqual(JSON.parse(relay), { ok: true });
  const registration = await checkDevBrowser(`http://localhost:${ports[2]}`);
  console.log(
    'PASS cold workspace: portfolio live GitHub data, auth readiness/sign-in/registration'
  );
  await stop();
  env['AUTH_RELAY_PORT'] = String(ports[3]);
  await start();
  await response(ports[3], '/health/ready');
  await checkDevBrowser(`http://localhost:${ports[3]}`, registration);
  console.log(
    'PASS warm restart: changed callback port, persisted operator/client, sign-in and revocation'
  );
  await stop();
  assert.equal(
    await Bun.file(join(cache, 'instance.pid')).exists(),
    false,
    'startup lock must be released'
  );
  const logs = await Promise.all(
    [1, 2].map((run) => readFile(join(logDir, `run-${run}.log`), 'utf8'))
  );
  for (const log of logs)
    assert.equal(
      /GitHub proof fetch failed|misconfigured|exited with code 1\b|ERROR.*run failed|Force killed Turborepo tasks/i.test(
        log
      ),
      false,
      `Startup or shutdown reported an error; inspect ${logDir}`
    );
  console.log('PASS graceful shutdown and clean startup logs');
} finally {
  try {
    await stop();
  } finally {
    await composeDown();
  }
}
