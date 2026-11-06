import { afterEach, expect, test } from 'bun:test';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../src/program';
import { wantsInteractive } from '../src/app';
import { addNode, readRoster } from '../src/roster';
import { COMMANDS, commandCatalog } from '../src/registry';
import { resolveSettings } from '../src/settings';
import { NODE } from '../../fleet/src/test-fixtures';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function settings() {
  const workspace = await mkdtemp(join(tmpdir(), 'personal-cli-test-'));
  directories.push(workspace);
  return { workspace, config: join(workspace, 'fleet.json') };
}

test('discovery, agent guide, schema and help need no roster or credentials', async () => {
  for (const args of [
    ['commands', '--json'],
    ['agent', '--json'],
    ['fleet', 'schema', '--json'],
    ['--help'],
    ['help'],
    ['help', 't3-apply'],
    ['fleet', 'add', '--help'],
  ]) {
    const result = await execute(args, await settings(), '1.2.3');
    expect(result.exitCode).toBe(0);
    expect(result.data).toBeObject();
  }
  expect(new Set(COMMANDS.map((entry) => entry.id)).size).toBe(COMMANDS.length);
  expect(
    COMMANDS.filter((entry) => entry.mutation).map((entry) => entry.id)
  ).toEqual([
    't3-apply',
    't3-cleanup',
    't3-import',
    'fleet-node-sync',
    'fleet repair',
    'fleet add',
    'fleet sync',
    'fleet init',
  ]);
  expect(
    commandCatalog('docter').some((entry) => entry.id === 'fleet doctor')
  ).toBe(true);
  expect(
    commandCatalog('ssh', 'Reference').every(
      (entry) => entry.group === 'Reference'
    )
  ).toBe(true);
  expect(commandCatalog('zzzzunfindablezzzzz')).toHaveLength(0);
});

test('interactive routing never prompts agents, redirected terminals or CI', () => {
  expect(wantsInteractive([], true, false)).toBe(false);
  expect(wantsInteractive(['--config', '/tmp/fleet.json'], true, false)).toBe(
    false
  );
  expect(wantsInteractive(['--interactive'], true, false)).toBe(true);
  expect(wantsInteractive(['--interactive'], true, true)).toBe(false);
  expect(wantsInteractive(['--interactive', 't3-cleanup'], true, false)).toBe(
    false
  );
  expect(wantsInteractive(['fleet', 'nodes'], true, false)).toBe(false);
  expect(wantsInteractive(['--json', '--interactive'], true, false)).toBe(
    false
  );
  expect(wantsInteractive(['--non-interactive'], true, false)).toBe(false);
  expect(wantsInteractive([], false, false)).toBe(false);
  expect(wantsInteractive([], true, true)).toBe(false);
});

test('usage errors never echo arbitrary option values or silently authorize mutation', async () => {
  const base = await settings();
  for (const args of [
    ['--unknown-secret=do-not-echo'],
    ['fleet', 'add', '--id', 'do-not-echo'],
    ['fleet', 'init', '--apply'],
    ['fleet', 'doctor', '--apply', '--yes'],
    ['fleet', 'doctor', '--all', '--local'],
    ['fleet', 'doctor', '--timeout', 'not-a-number'],
  ]) {
    const result = await execute(args, base, '1.2.3');
    expect(result.exitCode).toBe(2);
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
  }
  expect(await readRoster(base.config)).toBeNull();
});

test('register previews, explicit writes preserve nodes, and duplicates fail', async () => {
  const base = await settings();
  const args = [
    'fleet',
    'add',
    '--id',
    'first',
    '--ssh',
    'first',
    '--path',
    '/workspace',
    '--json',
  ];
  expect((await execute(args, base, '1.2.3')).exitCode).toBe(0);
  expect(await readRoster(base.config)).toBeNull();
  expect(
    (await execute([...args, '--apply', '--yes'], base, '1.2.3')).exitCode
  ).toBe(0);
  await addNode(base.config, { ...NODE, id: 'second' }, true);
  expect((await readRoster(base.config))?.nodes.map((node) => node.id)).toEqual(
    ['first', 'second']
  );
  const before = await readFile(base.config, 'utf8');
  expect(
    (await execute([...args, '--apply', '--yes'], base, '1.2.3')).exitCode
  ).toBe(2);
  expect(await readFile(base.config, 'utf8')).toBe(before);
  const onboarding = await execute(
    ['fleet', 'onboard', '--node', 'first', '--json'],
    base,
    '1.2.3'
  );
  expect(onboarding.data).toMatchObject({
    nodes: [{ verifyCommand: 'personal fleet doctor --node first --json' }],
  });
  if (process.platform !== 'win32')
    expect((await stat(base.config)).mode & 0o777).toBe(0o600);
});

test('concurrent writers fail closed rather than lose entries', async () => {
  const base = await settings();
  await writeFile(`${base.config}.lock`, '');
  await expect(addNode(base.config, NODE, true)).rejects.toThrow('locked');
  expect(await readRoster(base.config)).toBeNull();
});

test.skipIf(process.platform === 'win32')(
  'symlink rosters are refused without touching their target',
  async () => {
    const base = await settings();
    const target = join(base.workspace, 'target.json');
    await writeFile(target, JSON.stringify({ version: 1, nodes: [NODE] }));
    await symlink(target, base.config);
    await expect(
      addNode(base.config, { ...NODE, id: 'other' }, true)
    ).rejects.toThrow('regular file');
    expect(JSON.parse(await readFile(target, 'utf8')).nodes).toHaveLength(1);
  }
);

test('explicit configuration and workspace override environment defaults', async () => {
  const base = await settings();
  expect(
    await resolveSettings(base, base.workspace, {
      PERSONAL_WORKSPACE: '/wrong',
      PERSONAL_FLEET_CONFIG: '/wrong',
    })
  ).toEqual(base);
});

test('listing an unconfigured fleet is an empty first-run state; validation and unsafe rosters still fail', async () => {
  const base = await settings();
  const result = await execute(['fleet', 'nodes', '--json'], base, '1.2.3');
  expect(result.exitCode).toBe(0);
  expect(result.data).toMatchObject({ ok: true, configured: false, nodes: [] });
  expect(
    (await execute(['fleet', 'validate', '--json'], base, '1.2.3')).exitCode
  ).toBe(2);
  await writeFile(base.config, '{broken');
  expect(
    (await execute(['fleet', 'nodes', '--json'], base, '1.2.3')).exitCode
  ).toBe(2);
});

test('bare invocation is help and JSON discovery aliases share the same index', async () => {
  const base = await settings();
  const bare = await execute([], base, '1.2.3');
  const help = await execute(['--help'], base, '1.2.3');
  expect(bare.exitCode).toBe(0);
  expect(bare.text).toBe(help.text);
  expect(bare.text).toContain('Usage: personal');
  expect(bare.text).toContain('--json does not make a command read-only');
  const catalog = await execute(['commands', '--json'], base, '1.2.3');
  expect((await execute(['index', '--json'], base, '1.2.3')).data).toEqual(
    catalog.data
  );
  expect((await execute(['--json'], base, '1.2.3')).data).toEqual(catalog.data);
  const data = catalog.data as {
    commands: { id: string; help: string; execution: { default: string } }[];
  };
  expect(
    data.commands.find((entry) => entry.id === 't3-apply')?.execution.default
  ).toBe('apply');
  expect(
    data.commands.find((entry) => entry.id === 'fleet sync')?.execution.default
  ).toBe('preview');
  expect(
    data.commands.find((entry) => entry.id === 'fleet-status')?.execution
      .default
  ).toBe('read-only');
  expect(data.commands.every((entry) => entry.help.endsWith('--help'))).toBe(
    true
  );
  expect(await readRoster(base.config)).toBeNull();
});

test('every indexed command has read-only help without a checkout or credentials', async () => {
  const base = await settings();
  for (const entry of COMMANDS) {
    const result = await execute([...entry.args, '--help'], base, 'test');
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('Usage:');
  }
  expect((await execute(['workstation'], base, 'test')).text).toContain(
    'Domains:'
  );
});
