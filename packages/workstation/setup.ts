#!/usr/bin/env bun
/**
 * Deprecated: use `bun run personal:install` (repo root) or the `personal` CLI.
 *
 * This shim preserves the old entry point by forwarding to the new global
 * installer (`cli/install-global.ts`), which installs/overwrites the `personal`
 * launcher and converges the workstation.
 *
 * Usage:
 *   bun run personal:install
 *   personal workstation sync
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const installer = join(import.meta.dir, 'cli/install-global.ts');
const result = spawnSync('bun', [installer, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
