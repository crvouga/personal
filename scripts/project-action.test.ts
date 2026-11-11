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
    writeFileSync(
      join(root, 'scripts/dev/bootstrap.sh'),
      '#!/bin/bash\nexit 0\n'
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
    // Other commands need the checkout fleet-sync prepares.
    expect(run('fleet-status').status).toBe(3);
    writeFileSync(join(root, 'fleet.revision'), 'main\n');
    expect(run('fleet-sync').status).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('project actions are named exactly like the personal commands they run', async () => {
  const { COMMANDS } = await import('../packages/personal-cli/src/registry');
  const ids = new Set(COMMANDS.map((command) => command.id.split(' ')[0]));
  const script = readFileSync(join(import.meta.dir, 'dev/project-action.sh'));
  const list = /^warm \|.*\) ;;$/m.exec(script.toString())?.[0] ?? '';
  const actions = list.replace(/\) ;;$/, '').split(' | ');
  expect(actions.length).toBeGreaterThan(3);
  for (const action of actions) {
    if (action === 'warm' || action === 'portfolio') continue;
    const domain = action.startsWith('workstation-') ? 'workstation' : action;
    expect(ids.has(domain), action).toBe(true);
  }
  expect(script.toString()).not.toMatch(/fleet-converge|fleet-health/);
  const readme = readFileSync(join(import.meta.dir, 'dev/README.md'), 'utf8');
  for (const action of actions) expect(readme).toContain(`\`${action}\``);
  expect(readme).not.toMatch(/fleet-converge|fleet-health/);
});
