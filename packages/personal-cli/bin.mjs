#!/usr/bin/env node
// Source-owned launcher; installed as a symlink, never rendered outside Git.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, sep } from 'node:path';
const entry = fileURLToPath(new URL('./src/cli.ts', import.meta.url));
const checkout = resolve(dirname(entry), '../../..').split(
  `${sep}node_modules${sep}.fleet-revisions${sep}`
)[0];
const result = spawnSync('bun', [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PERSONAL_WORKSPACE: process.env.PERSONAL_WORKSPACE ?? checkout,
  },
});
if (result.error)
  process.stderr.write(
    'personal requires the shared Bun toolchain. Run the machine bootstrap.\n'
  );
process.exitCode = result.status ?? 1;
