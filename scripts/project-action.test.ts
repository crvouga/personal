import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('fleet actions run dev-fleet through the pinned wrapper and forward preview flags', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-action-'));
  try {
    mkdirSync(join(root, 'scripts/dev'), { recursive: true });
    writeFileSync(
      join(root, 'scripts/dev/project-action.sh'),
      readFileSync(join(import.meta.dir, 'dev/project-action.sh'))
    );
    // Fleet actions must not run this repository's toolchain bootstrap.
    writeFileSync(
      join(root, 'scripts/dev/bootstrap.sh'),
      '#!/bin/bash\nexit 9\n'
    );
    writeFileSync(
      join(root, 'scripts/dev/fleet.sh'),
      '#!/bin/sh\nprintf "%s\\n" "$@"\n'
    );
    const result = spawnSync(
      'bash',
      ['scripts/dev/project-action.sh', 'fleet-sync', '--dry-run'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, HOME: root, PATH: '/usr/bin:/bin' },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'fleet-sync',
      '--dry-run',
    ]);
    const preview = spawnSync(
      'bash',
      ['scripts/dev/project-action.sh', 'fleet-preview', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, HOME: root, PATH: '/usr/bin:/bin' },
      }
    );
    expect(preview.stdout.trim().split('\n')).toEqual([
      'fleet-sync',
      '--dry-run',
      '--json',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the wrapper runs the manager entry of the pinned revision with this fleet.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-wrapper-'));
  const sha = 'b'.repeat(40);
  try {
    mkdirSync(join(root, 'scripts/dev'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, '.local/share/dev-fleet/source/.git'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'scripts/dev/fleet.sh'),
      readFileSync(join(import.meta.dir, 'dev/fleet.sh'))
    );
    writeFileSync(join(root, 'fleet.revision'), sha + '\n');
    writeFileSync(
      join(root, 'fleet.json'),
      JSON.stringify(
        { source: { repository: 'https://example.com/fleet.git' } },
        null,
        2
      )
    );
    // A fake git: the pinned commit exists and its entry script prints what
    // it was given.
    writeFileSync(
      join(root, 'bin/git'),
      `#!/bin/sh\ncase "$*" in *show*) printf '%s\\n' 'printf "%s\\n" "$DEVFLEET_CONFIG" "$@"';; esac\nexit 0\n`,
      { mode: 0o755 }
    );
    const run = (...args: string[]) =>
      spawnSync('sh', ['scripts/dev/fleet.sh', ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: root,
          PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        },
      });
    const sync = run('fleet-sync', '--dry-run');
    expect(sync.status).toBe(0);
    expect(sync.stdout.trim().split('\n')).toEqual([
      expect.stringMatching(/fleet\.json$/),
      sha,
      '--dry-run',
    ]);
    // Other commands need a checkout fleet-sync prepared: the manager's run
    // checkout, or the revision applied on a worker.
    expect(run('fleet-status').status).toBe(3);
    const applied = join(root, '.local/share/personal/fleet/revisions', sha);
    mkdirSync(join(applied, 'node_modules'), { recursive: true });
    writeFileSync(
      join(root, 'bin/mise'),
      '#!/bin/sh\nprintf "%s\\n" "$PWD" "$*"\n',
      { mode: 0o755 }
    );
    const status = run('fleet-status', '--workers');
    expect(status.status).toBe(0);
    expect(status.stdout.trim().split('\n')).toEqual([
      applied,
      'exec --locked bun -- bun src/cli/cli.ts fleet-status --workers',
    ]);
    writeFileSync(join(root, 'fleet.revision'), 'main\n');
    expect(run('fleet-sync').status).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('project actions are documented, and fleet actions go to dev-fleet', () => {
  const script = readFileSync(
    join(import.meta.dir, 'dev/project-action.sh'),
    'utf8'
  );
  const list = /^warm \|.*\) ;;$/m.exec(script)?.[0] ?? '';
  const actions = list.replace(/\) ;;$/, '').split(' | ');
  expect(actions.length).toBeGreaterThan(3);
  for (const action of actions.filter(
    (action) => action.startsWith('fleet-') || action === 'infra-cliproxy'
  ))
    expect(script).toMatch(
      new RegExp(`^${action}\\) exec sh scripts/dev/fleet(-health)?\\.sh `, 'm')
    );
  const readme = readFileSync(join(import.meta.dir, 'dev/README.md'), 'utf8');
  for (const action of actions) expect(readme).toContain(`\`${action}\``);
});

test('fleet health runs every read-only check and fails when one does', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-health-'));
  try {
    mkdirSync(join(root, 'scripts/dev'), { recursive: true });
    writeFileSync(
      join(root, 'scripts/dev/fleet-health.sh'),
      readFileSync(join(import.meta.dir, 'dev/fleet-health.sh'))
    );
    const run = (wrapper: string) => {
      writeFileSync(join(root, 'scripts/dev/fleet.sh'), wrapper);
      return spawnSync('sh', ['scripts/dev/fleet-health.sh'], {
        cwd: root,
        encoding: 'utf8',
      });
    };
    const healthy = run('#!/bin/sh\necho "$*"\n');
    expect(healthy.status).toBe(0);
    const commands = healthy.stdout.trim().split('\n');
    expect(commands.slice(0, 2)).toEqual([
      'fleet-status --workers',
      't3-status',
    ]);
    // Nothing that changes a machine.
    for (const command of commands)
      expect(command).toMatch(/^(fleet-status|t3-status|cliproxy status)/);
    const failing = run(
      '#!/bin/sh\necho "$*"\n[ "$1" != fleet-status ] || exit 1\n'
    );
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain('t3-status');
    expect(failing.stderr).toContain('Failing: workers');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
