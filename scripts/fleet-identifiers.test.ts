import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
/** Anything that names this one fleet: its owner, domain, tailnet or machines. */
const PERSONAL = /chrisvouga|crvouga|tail4829dc|chris-vouga|chriss-mac/i;

/** This fleet's own configuration: the only place such names belong. */
const CONFIG = new Set([
  'packages/fleet/definition.json',
  'packages/fleet/migrations/workstation-network-v1.json',
  'packages/cliproxy-fleet/public-endpoint.json',
  'packages/cliproxy-fleet/models.json',
]);

/** Code that still names this fleet, by what has to change. The list may only
 * shrink: a file that is clean must be removed from it, and no file may be
 * added. Each group is one step of making the fleet code reusable.
 */
const DEBT: Record<string, string[]> = {
  'Vault address and login: move behind a secrets provider': [
    'packages/cliproxy-fleet/scripts/cloud_state.py',
    'packages/cliproxy-fleet/scripts/vault-access.py',
    'packages/cliproxy-fleet/scripts/vault-backup-login',
  ],
  'launchd labels and tool names: renaming them migrates running machines': [
    'packages/fleet/macos/policy.json',
    'packages/cliproxy-fleet/requirements.lock',
    'packages/cliproxy-fleet/scripts/cliproxy_host.py',
    'packages/cliproxy-fleet/scripts/retention.py',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-backup-check.plist',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-backup.plist',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-fleet.plist',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-gc.plist',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-monitor.plist',
    'packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-vault-renew.plist',
    'scripts/dev/global-config.ts',
    'scripts/dev/shell-path.ts',
  ],
  'source repository and package name: read them from the fleet config': [
    'packages/cliproxy-fleet/scripts/install.py',
    'packages/cliproxy-fleet/scripts/audit.py',
    'packages/cliproxy-fleet/clients/launcher.py',
    'packages/cliproxy-fleet/clients/bootstrap.py',
    'packages/personal-cli/src/agent-guide.ts',
    'packages/personal-cli/src/fleet-sync-schedule.ts',
    'scripts/dev/bootstrap.sh',
    'scripts/dev/bootstrap.ps1',
  ],
};

const SCANNED = [
  'packages/fleet',
  'packages/cliproxy-fleet',
  'packages/personal-cli/src',
  'scripts/dev',
];
const SKIPPED = /\.test\.|\/tests\/|\.md$|\/docs\/|\/vendor\/|\.(png|svg)$/;

async function naming(): Promise<string[]> {
  const tracked = (
    await Bun.$`git -C ${root} ls-files -- ${SCANNED}`.text()
  ).split('\n');
  return tracked
    .filter((path) => path && !SKIPPED.test(path) && !CONFIG.has(path))
    .filter((path) => PERSONAL.test(readFileSync(resolve(root, path), 'utf8')))
    .sort();
}

test('fleet code names this fleet only where it is still listed as debt', async () => {
  expect(await naming()).toEqual(Object.values(DEBT).flat().sort());
});
