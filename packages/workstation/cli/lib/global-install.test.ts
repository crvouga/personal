import { expect, test } from 'bun:test';

import { isOnPath, pathExportLine } from './global-install';

test('isOnPath matches exact PATH entries', () => {
  expect(isOnPath('/a/.local/bin', '/a/.local/bin:/usr/bin')).toBe(true);
  expect(isOnPath('/a/.local/bin', '/usr/bin:/bin')).toBe(false);
  expect(isOnPath('/a/.local/bin', '')).toBe(false);
});

test('pathExportLine uses fish syntax for fish RCs', () => {
  expect(pathExportLine('/h/.local/bin', '/h/.config/fish/config.fish')).toBe(
    'fish_add_path "/h/.local/bin"'
  );
  expect(pathExportLine('/h/.local/bin', '/h/.zshrc')).toBe(
    'export PATH="/h/.local/bin:$PATH"'
  );
});

test('legacy migration removes only recognized owned launchers', async () => {
  const { mkdtemp, writeFile, readFile, rm, access } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { removeLegacyLauncher } = await import('./global-install');
  const dir = await mkdtemp(join(tmpdir(), 'personal-launcher-'));
  try {
    await writeFile(
      join(dir, 'ws'),
      '#!/bin/sh\n# Managed by `ws install`\nexec bun /old/repo/cli/index.ts "$@"\n'
    );
    removeLegacyLauncher(dir);
    await expect(access(join(dir, 'ws'))).rejects.toThrow();
    await writeFile(join(dir, 'ws'), 'unrelated executable');
    expect(() => removeLegacyLauncher(dir)).toThrow('unrelated');
    expect(await readFile(join(dir, 'ws'), 'utf8')).toBe(
      'unrelated executable'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one source-owned personal launcher can move to a new deployment', async () => {
  if (process.platform === 'win32') return;
  const { mkdtemp, mkdir, writeFile, readlink, rm } =
    await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { installGlobalLauncher } = await import('./global-install');
  const { LinuxPlatform } = await import('./platform/linux');
  const dir = await mkdtemp(join(tmpdir(), 'personal-install-'));
  const platform = new LinuxPlatform();
  platform.globalBinDir = () => join(dir, 'bin');
  try {
    for (const version of ['one', 'two']) {
      const root = join(dir, version, 'packages');
      await mkdir(join(root, 'personal-cli'), { recursive: true });
      await writeFile(
        join(root, 'personal-cli/bin.mjs'),
        '// Source-owned launcher;\n'
      );
      const result = installGlobalLauncher(join(root, 'workstation'), platform);
      expect(await readlink(result.launcherPath)).toBe(
        join(root, 'personal-cli/bin.mjs')
      );
      expect(result.created).toBe(version === 'one');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
