import {
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkPrivateDirectory } from './paths.ts';
/** An interrupted write leaves only an unreferenced private temporary file. */
export function atomicPrivateWrite(
  path: string,
  data: string | Uint8Array
): void {
  const parent = dirname(path);
  checkPrivateDirectory(parent);
  const temporary = join(parent, `.pending-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
    const directory = openSync(parent, 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* Already renamed or absent. */
    }
    throw error;
  }
}
