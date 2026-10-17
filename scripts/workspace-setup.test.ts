import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('fresh workspace setup excludes runtime auth/cache environments and preserves existing configuration', () => {
  const temp = mkdtempSync(join(tmpdir(), 'workspace-setup-'));
  const primary = join(temp, 'primary');
  const workspace = join(temp, 'workspace');
  const binary = join(temp, 'bin');
  mkdirSync(workspace);
  mkdirSync(binary);
  writeFileSync(
    join(binary, 'bun'),
    '#!/bin/sh\ntest "$1" = install && test "$2" = --frozen-lockfile\n',
    { mode: 0o700 }
  );
  for (const name of ['auth-relay', 'turborepo-remote-cache', 'portfolio']) {
    const directory = join(primary, 'packages', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, '.env'), 'FIXTURE=primary\n');
  }
  const run = () =>
    Bun.spawnSync(['bash', resolve(import.meta.dir, '../.superset/setup.sh')], {
      env: {
        ...process.env,
        PATH: `${binary}:${process.env['PATH']}`,
        SUPERSET_ROOT_PATH: primary,
        SUPERSET_WORKSPACE_PATH: workspace,
      },
    });
  try {
    expect(run().exitCode).toBe(0);
    for (const name of ['auth-relay', 'turborepo-remote-cache'])
      expect(existsSync(join(workspace, 'packages', name, '.env'))).toBe(false);
    const portfolio = join(workspace, 'packages/portfolio/.env');
    expect(readFileSync(portfolio, 'utf8')).toBe('FIXTURE=primary\n');
    writeFileSync(portfolio, 'FIXTURE=workspace\n');
    expect(run().exitCode).toBe(0);
    expect(readFileSync(portfolio, 'utf8')).toBe('FIXTURE=workspace\n');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
