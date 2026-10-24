import {
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Config } from '../domain/config.ts';
import type { WorkflowContext } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import {
  encryptBackup,
  decryptBackup,
  MAX_BACKUP,
} from '../adapters/backup-crypto.ts';
import { checkPrivateFile, ensurePrivateDirectory } from '../adapters/paths.ts';
import { SqliteState } from '../adapters/state.ts';
import { MemorySecrets } from '../testing/fakes.ts';
import {
  snapshotMetadata,
  referencedSecrets,
  parseBackup,
  hydrateStaging,
  hydrateMetadata,
  type BackupPayload,
} from './backup-format.ts';
export type BackupReadContext = Pick<
  WorkflowContext,
  'state' | 'secrets' | 'runtime'
>;
export async function createBackup(input: {
  context: WorkflowContext;
  config: Config;
  directory: string;
}) {
  return input.context.state.withLock('backup', async () => writeBackup(input));
}
async function writeBackup(input: {
  context: WorkflowContext;
  config: Config;
  directory: string;
}) {
  const { context, config } = input;
  const directory = join(input.directory, 'backups');
  ensurePrivateDirectory(directory);
  const metadata = context.state.transaction(() =>
    snapshotMetadata(context.state)
  );
  const staging: Record<string, string> = {};
  for (const ref of referencedSecrets(metadata))
    staging[ref] = (await context.secrets.getRequired(ref)).readSecretValue();
  const shared = config.sources.some(
    (s) => s.kind === 'bitwarden' && s.includeShared
  );
  const vault = (await context.vault.list()).filter(
    (item) => !item.organizationId || shared
  );
  const payload: BackupPayload = {
    version: 2,
    createdAt: context.runtime.now(),
    config,
    vault,
    folders: (await context.vault.folders?.()) ?? [],
    metadata,
    staging,
  };
  parseBackup(payload);
  const password = (
    await context.secrets.getRequired(config.backupPasswordRef)
  ).readSecretValue();
  const encrypted = await encryptBackup(JSON.stringify(payload), password);
  const id = context.runtime.id();
  const digest = createHash('sha256').update(encrypted).digest('hex');
  writeFileSync(join(directory, `${id}.pwm`), encrypted, {
    mode: 0o600,
    flag: 'wx',
  });
  context.state.put('backups', {
    id,
    createdAt: payload.createdAt,
    digest,
    verifiedAt: null,
    vaultItems: vault.length,
  });
  return {
    id,
    status: 'created',
    digest,
    mode: 'independent-password AES-256-GCM container; scrypt N=32768 r=8 p=1',
    limitations: [
      'attachments contain metadata only',
      'passkey portability depends on supported credential exchange',
      'shared items require explicit opt-in; organization collection definitions require a separately selected native organization export',
      'browser sessions and OAuth tokens excluded',
      'Retain the independent password outside Bitwarden and outside this machine.',
    ],
  };
}
export async function readBackup(input: {
  file: string;
  password: string;
}): Promise<BackupPayload> {
  checkPrivateFile(input.file);
  if (statSync(input.file).size > MAX_BACKUP + 100)
    throw new ManagerError('invalid-input');
  return parseBackup(
    JSON.parse(await decryptBackup(readFileSync(input.file), input.password))
  );
}
export async function verifyBackup(input: {
  context: BackupReadContext;
  config: Config;
  directory: string;
  id: string;
}) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.id))
    throw new ManagerError('invalid-input');
  const path = join(input.directory, 'backups', `${input.id}.pwm`);
  const password = (
    await input.context.secrets.getRequired(input.config.backupPasswordRef)
  ).readSecretValue();
  const payload = await readBackup({ file: path, password });
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-restore-'));
  const isolated = new SqliteState(directory);
  try {
    const isolatedSecrets = new MemorySecrets();
    hydrateMetadata(payload, isolated);
    await hydrateStaging(payload, isolatedSecrets);
    const restored = snapshotMetadata(isolated);
    if (JSON.stringify(restored) !== JSON.stringify(payload.metadata))
      throw new ManagerError('invalid-input');
    const backup = input.context.state.get('backups', input.id);
    if (backup)
      input.context.state.put('backups', {
        ...backup,
        verifiedAt: input.context.runtime.now(),
      });
    return {
      id: input.id,
      status: 'verified',
      vaultItems: payload.vault.length,
      stagedSecrets: referencedSecrets(payload.metadata).size,
      tested: [
        'authenticated decryption',
        'validated source configuration',
        'every metadata record restored into isolated SQLite',
        'all referenced staging hydrated and read back in an isolated secret store',
      ],
      notTested: [
        'live Bitwarden restore',
        'attachments',
        'hardware/passkey portability',
        'independent password availability after machine loss',
      ],
    };
  } finally {
    isolated.close();
    rmSync(directory, { recursive: true });
  }
}
