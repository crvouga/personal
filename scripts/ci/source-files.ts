/** Enumerate repository sources without walking ignored dependency/cache trees. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function sourceFiles(directory: string): string[] {
  return [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: directory, encoding: 'utf8' }
      )
        .split('\0')
        .filter(Boolean)
    ),
  ].filter((file) => existsSync(join(directory, file)));
}
