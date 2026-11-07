import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installRemoteAgent } from './remote';
import { runCommand } from '../runner';

test('remote monitoring reports a real competing flock without starting mise', async () => {
  if (process.platform !== 'linux') return;
  const home = await mkdtemp(join(tmpdir(), 'fleet-monitoring-lock-'));
  const revision = 'a'.repeat(40);
  const root = join(home, '.local/share/personal/fleet');
  await mkdir(join(root, 'revisions', revision), { recursive: true });
  try {
    const checks = await installRemoteAgent(
      { id: 'fixture', ssh: 'fixture', workspace: '/unused', required: [] },
      revision,
      { mode: 'hub', hubUrl: 'https://fixture.example.ts.net:8443' },
      (args, options) =>
        runCommand(
          [
            'flock',
            join(root, 'remote-operation.lock'),
            'sh',
            '-c',
            args.at(-1)!,
          ],
          { ...options, env: { HOME: home } }
        )
    );
    expect(checks[0]?.id).toBe('beszel:lock');
    expect(checks[0]?.summary).toBe('FLEET_REMOTE_LOCKED');
    expect(checks[0]?.status).toBe('fail');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
