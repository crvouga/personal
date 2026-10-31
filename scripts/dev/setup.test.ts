import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishGlobalConfig } from './global-config';
import { appendOnce, miseDataDir } from './shell-path';
import { dockerChecks, toolChecks } from './doctor';

test('global config publishes lock sidecars, is repeatable and refuses foreign configs', () => {
  const temp = mkdtempSync(join(tmpdir(), 'toolchain-'));
  const source = join(temp, 'source');
  const target = join(temp, 'global');
  mkdirSync(join(source, '.mise/locks'), { recursive: true });
  writeFileSync(join(source, 'mise.toml'), '[tools]\nbun = "1.4.4"\n');
  writeFileSync(join(source, 'mise.lock'), 'fixture lock');
  writeFileSync(join(source, '.mise/locks/npm.json'), 'fixture graph');
  try {
    publishGlobalConfig(target, source);
    publishGlobalConfig(target, source);
    expect(readFileSync(join(target, 'mise.lock'), 'utf8')).toBe(
      'fixture lock'
    );
    expect(readFileSync(join(target, '.mise/locks/npm.json'), 'utf8')).toBe(
      'fixture graph'
    );
    writeFileSync(join(target, 'config.toml'), '# my config\n');
    expect(() => publishGlobalConfig(target, source)).toThrow(
      'Nothing was overwritten'
    );
    expect(readFileSync(join(target, 'config.toml'), 'utf8')).toBe(
      '# my config\n'
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('shell PATH setup preserves existing content and does not duplicate itself', () => {
  const temp = mkdtempSync(join(tmpdir(), 'toolchain-shell-'));
  try {
    const path = join(temp, 'profile');
    writeFileSync(path, '# user config\n');
    appendOnce(path, '# managed\nexport PATH=example');
    const first = readFileSync(path, 'utf8');
    appendOnce(path, '# managed\nexport PATH=example');
    expect(readFileSync(path, 'utf8')).toBe(first);
    expect(first).toStartWith('# user config\n');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('doctor fails a shadowed/wrong tool version and distinguishes optional Docker', () => {
  const checks = toolChecks(
    { node: '22.22.3', bun: '1.4.4', atlas: { version: '1.3.0', lazy: true } },
    (args) => ({ ok: true, output: args[0] === 'node' ? 'v20.0.0' : '1.4.4' })
  );
  expect(checks.find((check) => check.id === 'node')?.status).toBe('fail');
  expect(checks.find((check) => check.id === 'bun')?.status).toBe('pass');
  expect(checks.find((check) => check.id === 'atlas')).toBeUndefined();
  const unavailable = () => ({ ok: false, output: '' });
  expect(
    dockerChecks(false, unavailable).every((check) => check.status === 'warn')
  ).toBe(true);
  expect(
    dockerChecks(true, unavailable).every((check) => check.status === 'fail')
  ).toBe(true);
});

test('mise data location follows native Windows and XDG overrides', () => {
  expect(
    miseDataDir('win32', { LOCALAPPDATA: '/windows/local' }, '/user')
  ).toBe(join('/windows/local', 'mise'));
  expect(miseDataDir('linux', {}, '/user')).toBe(
    join('/user', '.local', 'share', 'mise')
  );
  expect(miseDataDir('win32', { MISE_DATA_DIR: '/custom' }, '/user')).toBe(
    '/custom'
  );
  expect(miseDataDir('darwin', { XDG_DATA_HOME: '/xdg' }, '/user')).toBe(
    join('/xdg', 'mise')
  );
});

test('every base tool has locked artifacts for every supported OS/architecture', () => {
  const root = join(import.meta.dirname, '../..');
  const config = Bun.TOML.parse(
    readFileSync(join(root, 'mise.toml'), 'utf8')
  ) as {
    settings: { lockfile_platforms: string[] };
    tools: Record<string, string | { version: string; lazy?: boolean }>;
  };
  const lock = Bun.TOML.parse(
    readFileSync(join(root, 'mise.lock'), 'utf8')
  ) as {
    tools: Record<string, Array<Record<string, unknown>>>;
  };
  for (const [name, spec] of Object.entries(config.tools)) {
    if (typeof spec !== 'string' && spec.lazy) continue;
    const row = lock.tools[name]?.find(
      (entry) =>
        entry['version'] === (typeof spec === 'string' ? spec : spec.version)
    );
    expect(row, name).toBeDefined();
    if (row?.['aube']) {
      const graph = row['aube'] as { path: string; digest: string };
      expect(graph.digest).toStartWith('sha256:');
      expect(
        readFileSync(join(root, graph.path, 'aube-lock.yaml'), 'utf8')
      ).toContain('integrity:');
    } else
      for (const platform of config.settings.lockfile_platforms) {
        const artifact = row?.[`platforms.${platform}`] as
          { checksum?: string } | undefined;
        expect(artifact?.checksum, `${name} ${platform}`).toStartWith(
          'sha256:'
        );
      }
  }
});
