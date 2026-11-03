import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { mustRun } from './release-io';
import { ReleaseError } from './release-error';
import { npmCommand } from './npm';

const FILES = [
  'README.md',
  'releasing.md',
  'package.json',
  'cli.mjs',
  'probe.mjs',
  'schema.json',
  'commands.json',
];

export function validatePackedFiles(files: string[]): void {
  if (
    files.length !== FILES.length ||
    files.some((path) => !FILES.includes(path)) ||
    new Set(files).size !== FILES.length
  )
    throw new ReleaseError(
      'npm tarball contains missing/unexpected files. Refusing to publish source, credentials or an incomplete distribution.'
    );
}

export async function pack(
  root: string,
  destination: string
): Promise<{ path: string; integrity: string }> {
  const output = await mustRun(
    await npmCommand([
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      destination,
    ]),
    join(root, 'packages/personal-cli/dist')
  );
  const entries = JSON.parse(output) as {
    filename: string;
    files: { path: string }[];
  }[];
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    !entry ||
    basename(entry.filename) !== entry.filename
  )
    throw new ReleaseError('Unsupported npm pack response.');
  validatePackedFiles(entry.files.map((file) => file.path));
  const path = join(destination, entry.filename);
  return {
    path,
    integrity: `sha512-${createHash('sha512')
      .update(await readFile(path))
      .digest('base64')}`,
  };
}
