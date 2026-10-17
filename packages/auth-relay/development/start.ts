import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { command, waitFor, cancelCommands } from './process';
import { prepareSchema } from './schema';
import { developmentMode } from './mode';
import { lock } from './lock';
import { ensureDocker } from './docker';
import { localIdentity } from './identity';
import { localPorts } from './ports';
import { verifyDatabase } from './database';

const root = resolve(import.meta.dir, '../../..');
const { cache, project } = localIdentity(
  root,
  process.env['AUTH_DEV_INSTANCE']
);
const mode = developmentMode(process.env);
let env: NodeJS.ProcessEnv = { ...process.env };
let compose: string[] | undefined;
let server: Bun.Subprocess | undefined;
let stopping = false;
let stopped: Promise<void> | undefined;
let preparing: ReturnType<typeof Bun.serve> | undefined;
let unlock: (() => Promise<void>) | undefined;
function stop(): Promise<void> {
  stopping = true;
  stopped ??= drain();
  return stopped;
}
async function drain(): Promise<void> {
  if (preparing) await preparing.stop(true);
  await cancelCommands();
  server?.kill('SIGINT');
  if (server) {
    // Bun's watch supervisor can remain alive after the server closes.
    const deadline = setTimeout(() => server?.kill('SIGKILL'), 5000);
    await server.exited;
    clearTimeout(deadline);
  }
  try {
    if (compose)
      await command([...compose, 'stop', '--timeout', '10'], env, false, {
        timeoutMs: 30000,
        duringShutdown: true,
      });
  } finally {
    if (unlock) await unlock();
  }
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});

async function local(): Promise<void> {
  // Reserve the chosen application port throughout dependency bootstrap so
  // concurrent worktrees select different ports before either server is ready.
  preparing = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(env['PORT'] ?? 8081),
    fetch: () =>
      new Response('Preparing local auth relay. See its Turborepo task log.', {
        status: 503,
      }),
  });
  process.stdout.write(
    'LOCAL DEVELOPMENT: mock identity provider, not Google. No Vault or managed data is used.\n'
  );
  for (const tool of ['docker', 'tofu', 'atlas']) {
    if (!Bun.which(tool))
      throw new Error(
        `Local auth development requires ${tool} on PATH; see packages/auth-relay/README.md`
      );
  }
  await ensureDocker(env);
  if (stopping) return;
  await mkdir(cache, { recursive: true });
  unlock = await lock(cache);
  const ports = await localPorts(cache);
  env = {
    ...env,
    ...ports,
    AUTH_LOCAL_APP_PORT: env['PORT'] ?? '8081',
    TF_DATA_DIR: join(cache, '.terraform'),
    TF_VAR_state_passphrase: await stateKey(),
    TF_VAR_database_port: ports['AUTH_LOCAL_DATABASE_PORT'],
    TF_VAR_broker_port: ports['AUTH_LOCAL_BROKER_PORT'],
    TF_VAR_mock_port: ports['AUTH_LOCAL_MOCK_PORT'],
    TF_VAR_app_port: env['PORT'] ?? '8081',
  };
  compose = [
    'docker',
    'compose',
    '-p',
    project,
    '-f',
    join(import.meta.dir, 'compose.yml'),
  ];
  process.stdout.write(
    'Starting local database, identity provider and broker...\n'
  );
  await command(
    [...compose, 'up', '-d', '--build', '--wait', '--wait-timeout', '240'],
    env,
    false,
    { timeoutMs: 600000 }
  );
  process.stdout.write('Waiting for broker discovery readiness...\n');
  await waitFor(
    `http://127.0.0.1:${env['AUTH_LOCAL_BROKER_PORT']}/realms/master/.well-known/openid-configuration`
  );
  await verifyDatabase(compose, env);
  process.stdout.write('Preparing isolated schema and local OIDC clients...\n');
  Object.assign(env, await prepareSchema(root, cache, env), {
    AUTH_DEV_MODE: 'local',
  });
  process.stdout.write('Local setup credential: local-development-only\n');
}
async function stateKey(): Promise<string> {
  const path = join(cache, 'state.key');
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const key = Buffer.from(
      crypto.getRandomValues(new Uint8Array(48))
    ).toString('base64url');
    await writeFile(path, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
}
try {
  if (mode === 'local') await local();
  await preparing?.stop(true);
  preparing = undefined;
  if (!stopping) {
    server = Bun.spawn(['bun', '--watch', 'src/server.ts'], {
      cwd: resolve(import.meta.dir, '..'),
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (mode === 'local') {
      await Promise.race([
        waitFor(`http://127.0.0.1:${env['PORT'] ?? '8081'}/health/ready`),
        server.exited.then((code) => {
          throw new Error(`Auth relay exited before readiness (${code})`);
        }),
      ]);
      process.stdout.write(
        `Auth relay READY: http://localhost:${env['PORT'] ?? '8081'} (local mock sign-in)\n`
      );
    }
    const exit = await server.exited;
    process.exitCode = stopping ? 0 : exit;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Local auth startup failed'}\n`
  );
  process.exitCode = stopping ? 0 : 1;
} finally {
  await stop();
}
