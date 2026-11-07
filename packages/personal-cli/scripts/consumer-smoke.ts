import { mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../../fleet/src/runner';
import { mustRun, npmEnvironment } from './release-io';
import { consumerHelp } from './consumer-help';
import { consumerT3 } from './consumer-t3';
import { ReleaseError } from './release-error';
import { npmCommand } from './npm';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ReleaseError(`Consumer smoke failed: ${message}`);
}

export async function consumerSmoke(tarball: string): Promise<void> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'personal-consumer-'))
  );
  const config = join(directory, 'npmrc');
  await writeFile(config, 'registry=https://registry.npmjs.org/\n', {
    mode: 0o600,
  });
  const env = {
    ...npmEnvironment(directory),
    CI: '1',
    NO_COLOR: '1',
  };
  try {
    await mustRun(
      await npmCommand([
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--prefix',
        directory,
        tarball,
      ]),
      directory,
      env,
      { stage: 'consumer-install' }
    );
    await exercise(directory, env);
    await exerciseBinary(directory, env);
    await consumerT3(directory, env);
    await consumerHelp(directory, env);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function exerciseBinary(
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const output = await mustRun(
    await npmCommand([
      'exec',
      '--offline',
      '--no',
      '--',
      'personal',
      'commands',
      '--json',
    ]),
    directory,
    env,
    { stage: 'consumer-binary' }
  );
  assert(
    JSON.parse(output).command === 'commands',
    'installed npm executable must resolve the personal binary without a registry download'
  );
}

async function exercise(
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const node = Bun.which('node');
  assert(node, 'a real Node executable is required');
  const cli = join(directory, 'node_modules/@crvouga/personal/cli.mjs');
  for (const args of [
    ['commands', '--json'],
    ['fleet-nodes', '--schema', '--json'],
    ['fleet-repair', '--list', '--json'],
    [
      'fleet-nodes',
      '--config',
      join(directory, 'missing-fleet.json'),
      '--workspace',
      directory,
      '--json',
    ],
    ['--json'],
  ]) {
    const output = await mustRun([node, cli, ...args], directory, env, {
      stage: 'consumer-command',
    });
    assert(
      typeof JSON.parse(output) === 'object',
      'standalone JSON command must work without a checkout'
    );
  }
  await exerciseController(cli, node, directory, env);
  const version = await mustRun([node, cli, '--version'], directory, env, {
    stage: 'consumer-command',
  });
  assert(
    /^\d+\.\d+\.\d+ \(released \d{4}-\d{2}-\d{2}T[0-9:.]+Z\)\s*$/.test(version),
    'Node executable must report the release version and build timestamp'
  );
  const invalid = await runCommand(
    [node, cli, '--never-echo=private-value', '--json'],
    { cwd: directory, env }
  );
  assert(
    !invalid.ok && JSON.parse(invalid.stdout).code === 'invalid_usage',
    'invalid arguments must produce JSON'
  );
  assert(
    !`${invalid.stdout}${invalid.stderr}`.includes('private-value'),
    'errors must not reflect arbitrary input'
  );
  await exerciseLocal(directory, node, env);
  await exerciseProbe(directory, node, env);
}

async function exerciseLocal(
  directory: string,
  node: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const cli = join(directory, 'node_modules/@crvouga/personal/cli.mjs');
  const local = await runCommand(
    [
      node,
      cli,
      'fleet-status',
      '--local',
      '--require',
      'none',
      '--workspace',
      directory,
      '--json',
    ],
    { cwd: directory, env }
  );
  assert(
    !local.ok && JSON.parse(local.stdout).coverage.scope === 'local',
    'missing workspace must fail honestly'
  );
}

async function exerciseProbe(
  directory: string,
  node: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (process.platform === 'win32') return;
  const source = await readFile(
    join(directory, 'node_modules/@crvouga/personal/probe.mjs'),
    'utf8'
  );
  const request = Buffer.from(
    JSON.stringify({
      action: 'probe',
      node: {
        id: 'consumer',
        ssh: 'consumer',
        workspace: directory.replaceAll('\\', '/'),
        required: [],
      },
    })
  ).toString('base64');
  const response = await runCommand(
    [node, '--input-type=module', '-', request],
    { cwd: directory, env, input: source }
  );
  assert(
    response.ok && JSON.parse(response.stdout).version === 1,
    'bundled remote probe must run on Node without Bun'
  );
}

async function exerciseController(
  cli: string,
  node: string,
  directory: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const result = await runCommand(
    [
      node,
      cli,
      'fleet-sync',
      '--revision',
      'a'.repeat(40),
      '--dry-run',
      '--json',
    ],
    { cwd: directory, env }
  );
  const report = JSON.parse(result.stdout);
  assert(
    !result.ok &&
      report.version === 2 &&
      report.execution === 'controller-push' &&
      report.applied === false,
    'clean npm consumer must report missing controller enrollment without writes'
  );
}
