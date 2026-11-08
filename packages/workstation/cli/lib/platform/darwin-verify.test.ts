import { expect, test } from 'bun:test';
import { pmsetDrift, verifyDarwinMachine } from './darwin-verify';
import type { Runner } from '../../../../fleet/src/types';

const laptop = `Battery Power:
 lidwake              1
 sleep                0
 disksleep            0
 autorestart          1
 womp                 1
 powernap             0
AC Power:
 sleep                0
 disksleep            0
 autorestart          1
 womp                 1
 powernap             0
`;

test('pmset drift requires every declared value in every power-source section', () => {
  expect(pmsetDrift(laptop)).toEqual([]);
  expect(
    pmsetDrift(
      laptop.replace(
        'AC Power:\n sleep                0',
        'AC Power:\n sleep                10'
      )
    )
  ).toEqual(['sleep']);
  // Laptops do not list autorestart at all; an unsupported key is not drift.
  expect(pmsetDrift(laptop.replace(/^ autorestart.*\n/gm, ''))).toEqual([]);
  expect(
    pmsetDrift(
      laptop.replace(' powernap             0', ' powernap             1')
    )
  ).toEqual(['powernap']);
});

function runner(
  overrides: Record<string, { ok: boolean; stdout: string }>
): Runner {
  return async (command) => {
    const key = command.join(' ');
    const match = Object.entries(overrides).find(([prefix]) =>
      key.startsWith(prefix)
    );
    const value = match?.[1] ?? { ok: false, stdout: '' };
    return { ...value, stderr: '', reason: 'exit' as const };
  };
}

test('macOS evidence passes only with effective policy, loaded daemons and native login', async () => {
  const checks = await verifyDarwinMachine(
    { name: 'dev', uid: 501 },
    runner({
      '/usr/bin/pmset -g custom': { ok: true, stdout: laptop },
      '/usr/bin/defaults read': { ok: true, stdout: '0\n' },
      '/opt/homebrew/bin/tailscale status --json': {
        ok: true,
        stdout: JSON.stringify({
          BackendState: 'Running',
          Peer: { secret: 'never-shown' },
        }),
      },
      '/bin/launchctl print system/com.tailscale.tailscaled': {
        ok: true,
        stdout: 'state = running',
      },
      '/bin/launchctl print gui/501/dev.chrisvouga.personal.worker-auth': {
        ok: true,
        stdout: 'state = waiting',
      },
    })
  );
  expect(checks.map((check) => [check.id, check.status])).toEqual([
    ['macos:power', 'pass'],
    ['macos:session', 'pass'],
    ['macos:tailscale', 'pass'],
    ['worker:credential-renewal', 'pass'],
  ]);
  expect(JSON.stringify(checks)).not.toContain('never-shown');
});

test('an unloaded tailscaled daemon or enabled auto-logout fails with remedies', async () => {
  const checks = await verifyDarwinMachine(
    { name: 'dev', uid: 501 },
    runner({
      '/usr/bin/pmset -g custom': { ok: true, stdout: laptop },
      '/usr/bin/defaults read': { ok: true, stdout: '600\n' },
      '/opt/homebrew/bin/tailscale status --json': {
        ok: true,
        stdout: JSON.stringify({ BackendState: 'Running' }),
      },
    })
  );
  expect(checks.find((check) => check.id === 'macos:session')?.status).toBe(
    'fail'
  );
  expect(checks.find((check) => check.id === 'macos:tailscale')).toMatchObject({
    status: 'fail',
    remedy: expect.any(Object),
  });
  expect(
    checks.find((check) => check.id === 'worker:credential-renewal')?.status
  ).toBe('fail');
});
