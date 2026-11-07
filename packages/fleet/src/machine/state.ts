import {
  mkdir,
  readFile,
  rename,
  rm,
  lstat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FleetUsageError } from '../errors';
import { FleetLockError } from './lock-error';
import { record } from '../config';

export interface Enrollment {
  version: 1;
  id: string;
  approvedRevision: string;
  appliedRevision?: string;
  previousRevision?: string;
}

export const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export async function readEnrollment(root: string): Promise<Enrollment | null> {
  try {
    const path = join(root, 'enrollment.json');
    const info = await lstat(path);
    if (!info.isFile() || info.size > 4096) throw new Error();
    const data: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!validEnrollment(data)) throw new Error();
    return data as unknown as Enrollment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FleetUsageError(
      'Invalid enrollment state. Restore the private enrollment.json backup; do not enroll a replacement using another machine’s identity.'
    );
  }
}

export async function saveEnrollment(
  root: string,
  state: Enrollment
): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'enrollment.json');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Fail closed on interrupted locks: never steal a lock from a still-running installer. */
export async function withMachineLock<T>(
  root: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, 'sync.lock');
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      throw new FleetUsageError(
        'Cannot create controller lock; inspect private state-directory permissions and free disk space.'
      );
    throw new FleetLockError(
      'Fleet sync is locked. Inspect running installers before removing an abandoned sync.lock directory, then rerun.'
    );
  }
  try {
    await writeFile(
      join(lock, 'owner.json'),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }) + '\n',
      { flag: 'wx', mode: 0o600 }
    );
    return await operation();
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function ensurePrivateRoot(root: string): Promise<void> {
  for (let path = root; dirname(path) !== path; path = dirname(path)) {
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new FleetUsageError(
          'Fleet state paths cannot contain symbolic links.'
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function validEnrollment(data: unknown): boolean {
  if (!record(data) || data['version'] !== 1) return false;
  if (
    typeof data['id'] !== 'string' ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(data['id'])
  )
    return false;
  return (
    isRevision(data['approvedRevision']) &&
    ['appliedRevision', 'previousRevision'].every(
      (key) => data[key] === undefined || isRevision(data[key])
    )
  );
}
