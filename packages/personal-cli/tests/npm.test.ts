import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npmCommand } from '../scripts/npm';
import { runCommand } from '../../fleet/src/runner';

test('npm launchers are executed directly, not interpreted as JavaScript or dereferenced', async () => {
  for (const npm of ['/tools/npm', '/mise/shims/npm', '/tools/npm.exe']) {
    expect(
      await npmCommand(['--version'], { node: '/tools/node', npm })
    ).toEqual([npm, '--version']);
  }
});

test('Windows npm cmd launchers keep the Node entry point without a shell', async () => {
  expect(
    await npmCommand(['pack', '--json'], {
      node: '/tools/node.exe',
      npm: '/tools/npm.cmd',
    })
  ).toEqual([
    '/tools/node.exe',
    join('/tools', 'node_modules/npm/bin/npm-cli.js'),
    'pack',
    '--json',
  ]);
});

test('missing Node or npm produces actionable toolchain guidance', async () => {
  for (const executables of [
    { node: null, npm: '/tools/npm' },
    { node: '/tools/node', npm: null },
  ]) {
    await expect(npmCommand(['--version'], executables)).rejects.toThrow(
      'shared mise toolchain'
    );
  }
});

test.skipIf(!existsSync('/bin/sh'))(
  'a shell launcher and a mise-style symlink work through the release subprocess runner',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-npm-launcher-'));
    const launcher = join(directory, 'npm');
    const shim = join(directory, 'shims/npm');
    try {
      await writeFile(launcher, '#!/bin/sh\nprintf "11.20.0\\n"\n', {
        mode: 0o755,
      });
      await mkdir(join(directory, 'shims'));
      await symlink(launcher, shim);
      for (const npm of [launcher, shim]) {
        const result = await runCommand(
          await npmCommand(['--version'], { node: '/unused/node', npm }),
          { cwd: directory }
        );
        expect(result.ok).toBe(true);
        expect(result.stdout).toBe('11.20.0\n');
        expect(result.stderr).toBe('');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
