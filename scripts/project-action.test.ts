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

test('project convergence selects exact HEAD and forwards preview without adding apply approval', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-action-'));
  const sha = 'a'.repeat(40);
  try {
    mkdirSync(join(root, 'scripts/dev'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'scripts/dev/project-action.sh'),
      readFileSync(join(import.meta.dir, 'dev/project-action.sh'))
    );
    writeFileSync(
      join(root, 'scripts/dev/bootstrap.sh'),
      '#!/bin/bash\nexit 0\n'
    );
    writeFileSync(
      join(root, 'bin/git'),
      `#!/bin/sh\nprintf '%s\\n' '${sha}'\n`,
      { mode: 0o755 }
    );
    writeFileSync(join(root, 'bin/mise'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o755,
    });
    const result = spawnSync(
      'bash',
      ['scripts/dev/project-action.sh', 'fleet-sync', '--dry-run'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: root,
          PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'exec',
      '--',
      'bun',
      'run',
      'personal',
      'fleet-sync',
      '--revision',
      sha,
      '--dry-run',
    ]);
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
