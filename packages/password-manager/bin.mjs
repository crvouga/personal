#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(
  process.execPath,
  [
    '--import',
    fileURLToPath(import.meta.resolve('tsx')),
    fileURLToPath(new URL('./src/cli/main.ts', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' }
);
process.exitCode = result.status ?? 1;
