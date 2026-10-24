import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import type { SecretStore } from '@pkgs/secret-store';
import { scopedCommand, shellQuote } from '../domain/commands.ts';
import { parseConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import {
  assertPrivateLocation,
  ensurePrivateDirectory,
  checkPrivateFile,
} from '../adapters/paths.ts';
import { SqliteState } from '../adapters/state.ts';
import { writeConfig } from '../adapters/config-file.ts';
import { OsSecrets } from '../adapters/keychain.ts';
import { storeVaultSnapshot } from './vault-snapshot.ts';
import { readBackup } from './backup.ts';
import { hydrateStaging, hydrateMetadata } from './backup-format.ts';
interface RestoreMarker {
  digest: string;
  service: string;
  complete: boolean;
}
export async function restoreBackup(input: {
  file: string;
  password: string;
  destination: string;
  activeDirectory: string;
  secretFactory?: (service: string) => SecretStore;
}) {
  const destination = assertPrivateLocation(input.destination);
  const source = assertPrivateLocation(input.activeDirectory);
  if (
    overlap(source, destination) ||
    overlap(assertPrivateLocation(input.file), destination)
  )
    throw new ManagerError('unsafe-path');
  const payload = await readBackup(input);
  const digest = createHash('sha256')
    .update(readFileSync(input.file))
    .digest('hex');
  const marker = prepareDestination(destination, digest);
  if (marker.complete) return { status: 'already-restored', destination };
  const secrets = (
    input.secretFactory ?? ((service) => new OsSecrets(service))
  )(marker.service);
  const state = new SqliteState(destination);
  try {
    await hydrateStaging(payload, secrets);
    await storeVaultSnapshot(payload.vault, secrets, payload.folders);
    hydrateMetadata(payload, state);
    scopeRestoredActions(
      state,
      destination,
      payload.config.secretService,
      marker.service
    );
    const config = parseConfig({
      ...payload.config,
      secretService: marker.service,
      execution: { ...payload.config.execution, autoApply: false },
    });
    writeConfig(destination, config);
    finishMarker(destination, { ...marker, complete: true });
    return {
      status: 'restored-isolated',
      destination,
      vaultItems: payload.vault.length,
      next: [
        `bun run password-manager --state-dir ${shellQuote(destination)} status`,
        `In this isolated state, use secrets set to restore the configured Bitwarden client ID/secret references, then connect bitwarden to the original account and recover incomplete operations individually. Never place API keys or the master password in command arguments.`,
        'OAuth tokens and browser sessions are excluded: reconnect mail sources before new discovery.',
        'Vault contents remain an encrypted snapshot in the isolated OS secret namespace; no active-vault import was performed.',
      ],
    };
  } finally {
    state.close();
  }
}
function overlap(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (!rel || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)))
    return true;
  const reverse = relative(child, parent);
  return (
    !reverse ||
    (reverse !== '..' && !reverse.startsWith('../') && !isAbsolute(reverse))
  );
}
function prepareDestination(directory: string, digest: string): RestoreMarker {
  const path = join(directory, 'restoration.json');
  if (existsSync(path)) {
    checkPrivateFile(path);
    const marker = JSON.parse(readFileSync(path, 'utf8')) as RestoreMarker;
    if (
      marker.digest !== digest ||
      !/^workspace\.password-manager\.restore\.[a-f0-9]{32}$/.test(
        marker.service
      )
    )
      throw new ManagerError('conflict');
    return marker;
  }
  if (existsSync(directory) && readdirSync(directory).length)
    throw new ManagerError('unsafe-path');
  ensurePrivateDirectory(directory);
  const marker = {
    digest,
    service: `workspace.password-manager.restore.${randomBytes(16).toString('hex')}`,
    complete: false,
  };
  writeFileSync(path, JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
  return marker;
}
function finishMarker(directory: string, marker: RestoreMarker): void {
  const temporary = join(directory, 'restoration.new.json');
  writeFileSync(temporary, JSON.stringify(marker), { mode: 0o600 });
  renameSync(temporary, join(directory, 'restoration.json'));
}

function scopeRestoredActions(
  state: SqliteState,
  directory: string,
  previousService: string,
  service: string
): void {
  for (const action of state.list('actions')) {
    const text = (value: string) =>
      scopedCommand(value.replaceAll(previousService, service), directory);
    state.put('actions', {
      ...action,
      resume: text(action.resume),
      instructions: action.instructions.map(text),
      alternative: text(action.alternative),
    });
  }
}
