import { unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Config, SourceConfig } from '../domain/config.ts';
import type { StateStore } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import {
  checkPrivateFile,
  checkPrivateDirectory,
  assertPrivateLocation,
} from '../adapters/paths.ts';
import { fileProgress } from '../adapters/file-cursor.ts';
export async function cleanupExport(input: {
  config: Config;
  state: StateStore;
  sourceId: string;
  apply: boolean;
}) {
  return input.state.withLock(`source:${input.sourceId}`, async () => {
    const source = exportSource(input.config, input.sourceId);
    const path = assertPrivateLocation(source.path!);
    checkPrivateFile(path);
    checkPrivateDirectory(dirname(path));
    const coverage = input.state.get('coverage', source.id);
    if (coverage?.state !== 'scanned' || !coverage.cursor)
      throw new ManagerError('requires-user-action');
    const progress = await fileProgress(path, coverage.cursor);
    const cursor = JSON.parse(coverage.cursor) as { offset: number };
    if (progress.cursor(cursor.offset) !== coverage.cursor)
      throw new ManagerError('conflict');
    const evidence = input.state
      .list('evidence')
      .filter((e) => e.sourceId === source.id);
    if (
      !evidence.length ||
      evidence.some((e) => !verifiedImport(input.state, e.id))
    )
      throw new ManagerError('requires-user-action');
    if (input.apply) {
      await progress.unchanged();
      await unlink(path);
      input.state.put('coverage', { ...coverage, state: 'skipped' });
    }
    return {
      status: input.apply ? 'completed' : 'inspection',
      sourceId: source.id,
      importedItems: evidence.length,
      deleted: input.apply,
      note: 'Only the selected export file is removed. Original stores and encrypted candidates remain. SSD/prior-backup erasure is not guaranteed.',
    };
  });
}
function verifiedImport(state: StateStore, id: string): boolean {
  const mapping = state.get('imports', id);
  const operation = state.get('operations', mapping?.operationId ?? '');
  return Boolean(
    mapping &&
    operation?.state === 'completed' &&
    ['imported', 'updated'].includes(mapping.status ?? 'imported')
  );
}

function exportSource(config: Config, id: string): SourceConfig {
  const source = config.sources.find((s) => s.id === id);
  if (!source?.path || !['csv', 'bitwarden-json'].includes(source.kind))
    throw new ManagerError('invalid-input');
  return source;
}
