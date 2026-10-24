import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const config = JSON.parse(
  readFileSync('/private/password-manager/config.json', 'utf8')
);
assert.equal(config.version, 1);
const result = spawnSync(
  process.execPath,
  [
    'packages/password-manager/bin.mjs',
    '--state-dir',
    '/private/password-manager',
    '--non-interactive',
    'doctor',
  ],
  { encoding: 'utf8' }
);
const checks = JSON.parse(result.stdout);
for (const name of [
  'node',
  'platform',
  'declared-dependencies',
  'OS-packages',
  'OS-executables',
  'private-state',
  'chromium-native-libraries',
]) {
  assert.equal(checks.find((check) => check.name === name)?.status, 'ok', name);
}
assert.equal(
  checks.find((check) => check.name === 'bitwarden')?.status,
  'missing'
);
assert.equal(
  checks.find((check) => check.name === 'persistent-secret-store')?.status,
  'locked'
);
assert.equal(result.status, 2);
process.stdout.write(
  'Cold-start dependency acquisition and resumable onboarding verified.\n'
);

const configBefore = readFileSync(
  '/private/password-manager/config.json',
  'utf8'
);
const database = new DatabaseSync('/private/password-manager/workflow.sqlite', {
  readOnly: true,
});
const before = database
  .prepare("SELECT count(*) AS n FROM records WHERE kind='actions'")
  .get().n;
const repeated = spawnSync(
  process.execPath,
  [
    'packages/password-manager/bin.mjs',
    '--state-dir',
    '/private/password-manager',
    '--non-interactive',
    'setup',
  ],
  { encoding: 'utf8', timeout: 120000 }
);
assert.equal(repeated.status, 2);
assert.equal(
  readFileSync('/private/password-manager/config.json', 'utf8'),
  configBefore
);
assert.equal(
  database
    .prepare("SELECT count(*) AS n FROM records WHERE kind='actions'")
    .get().n,
  before
);
assert.equal(statSync('/private/password-manager/config.json').mode & 0o077, 0);
assert.equal(
  statSync('/private/password-manager/workflow.sqlite').mode & 0o077,
  0
);
database.close();
process.stdout.write(
  'Repeated setup preserves config, private permissions and action identities.\n'
);
