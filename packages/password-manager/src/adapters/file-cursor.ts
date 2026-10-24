import { stat } from 'node:fs/promises';
import { stableId } from '../domain/identity.ts';
import { ManagerError } from '../domain/errors.ts';

/** Resume only the same immutable file snapshot; never skip changed content. */
export async function fileProgress(path: string, cursor: string | null) {
  const file = await stat(path);
  if (!file.isFile()) throw new ManagerError('invalid-input');
  const fingerprint = stableId(
    String(file.dev),
    String(file.ino),
    String(file.size),
    String(file.mtimeMs)
  );
  let offset = 0;
  if (cursor) {
    const value = JSON.parse(cursor) as { file: string; offset: number };
    if (!Number.isSafeInteger(value.offset) || value.offset < 0)
      throw new ManagerError('invalid-input');
    if (value.file === fingerprint) offset = value.offset;
  }
  return {
    offset,
    cursor: (next: number) =>
      JSON.stringify({ file: fingerprint, offset: next }),
    unchanged: async () => {
      const current = await stat(path);
      if (current.size !== file.size || current.mtimeMs !== file.mtimeMs)
        throw new ManagerError('conflict');
    },
  };
}

export function sourcePath(path: string | undefined): string {
  if (!path) throw new ManagerError('invalid-config');
  return path;
}
