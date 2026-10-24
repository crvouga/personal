/** Install Chromium only when a browser-dependent task will actually execute. */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function needsBrowser(
  plan: unknown,
  readManifest: (directory: string) => unknown
): boolean {
  if (!record(plan) || !Array.isArray(plan.tasks) || !plan.tasks.length)
    return true;
  for (const task of plan.tasks) {
    if (
      !record(task) ||
      typeof task.task !== 'string' ||
      typeof task.directory !== 'string'
    )
      return true;
    if (record(task.cache) && task.cache.status === 'HIT') continue;
    if (task.task === 'tc' || task.task === 'lint') continue;
    try {
      const manifest = readManifest(task.directory);
      if (!record(manifest)) return true;
      for (const group of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
      ]) {
        const dependencies = manifest[group];
        if (
          record(dependencies) &&
          ('playwright' in dependencies || '@playwright/test' in dependencies)
        )
          return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

if (import.meta.main) {
  const result = spawnSync(
    'bunx',
    ['turbo', 'run', 'test', 'build', '--dry=json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  let install = true;
  if (result.status === 0) {
    try {
      install = needsBrowser(JSON.parse(result.stdout), (directory) =>
        JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      );
    } catch {
      // Unrecognized plans install browsers; the real Turbo run still validates.
    }
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `install=${install}\n`);
  console.log(
    install
      ? 'Browser tasks need Chromium'
      : 'Browser tasks are cached; reusing their validated outputs'
  );
}
