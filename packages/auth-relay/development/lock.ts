import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function lock(cache: string): Promise<() => Promise<void>> {
  const path = join(cache, 'instance.pid');
  try {
    await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await readFile(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 1)
      throw new Error(
        'Invalid auth development lock; inspect .superset/.auth-dev/instance.pid'
      );
    try {
      process.kill(pid, 0);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure;
      await unlink(path);
      return lock(cache);
    }
    throw new Error(
      `Auth relay development is already running for this worktree (pid ${pid}). Stop its Run task first, or use another worktree.`
    );
  }
  return async () => {
    if ((await readFile(path, 'utf8')) === String(process.pid))
      await unlink(path);
  };
}
