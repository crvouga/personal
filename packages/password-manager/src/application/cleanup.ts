import { pruneBackups } from './backup-retention.ts';
import type { Config } from '../domain/config.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
export async function cleanup(input: {
  config: Config;
  state: StateStore;
  runtime: Runtime;
  secrets: { remove(name: string): Promise<void> };
  apply: boolean;
  directory: string;
}) {
  const expired = input.state
    .list('operations')
    .filter(
      (op) =>
        op.state === 'completed' &&
        op.kind === 'rotate' &&
        op.completedAt &&
        Date.parse(input.runtime.now()) - Date.parse(op.completedAt) >
          input.config.retentionDays * 86400_000
    );
  const refs = expired.flatMap((op) =>
    [op.oldRef, op.stagedRef].filter((ref): ref is string => ref !== null)
  );
  if (input.apply) {
    for (const ref of refs) await input.secrets.remove(ref);
    for (const op of expired)
      input.state.put('operations', { ...op, oldRef: null, stagedRef: null });
  }
  return {
    status: input.apply ? 'completed' : 'inspection',
    expiredOperations: expired.map((o) => o.id),
    expiredBackups: await pruneBackups(input),
    note: 'Source exports and old vault/browser records remain intact. Select their deletion separately after verified migration; SSD erasure cannot be guaranteed.',
  };
}
