import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../domain/config.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { checkPrivateFile } from '../adapters/paths.ts';
export async function pruneBackups(input: {
  config: Config;
  state: StateStore;
  runtime: Runtime;
  directory: string;
  apply: boolean;
}) {
  return input.state.withLock('backup', async () => {
    const cutoff =
      Date.parse(input.runtime.now()) - input.config.retentionDays * 86400_000;
    const expired = input.state
      .list('backups')
      .filter((b) => b.verifiedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(2)
      .filter((b) => Date.parse(b.createdAt) < cutoff);
    for (const record of expired) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(record.id))
        throw new ManagerError('invalid-input');
      const file = join(input.directory, 'backups', record.id + '.pwm');
      if (existsSync(file)) checkPrivateFile(file);
      if (!input.apply) continue;
      if (existsSync(file)) unlinkSync(file);
      input.state.remove('backups', record.id);
    }
    return expired.map((b) => b.id);
  });
}
