import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { SecretStore } from '@pkgs/secret-store';
import type { Config } from '../domain/config.ts';
import type { Vault, VaultItem } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { baseEnvironment, command, type Command } from './process.ts';
import { ensurePrivateDirectory } from './paths.ts';
const require = createRequire(import.meta.url);
export const BW_VERSION = '2026.10.0';
export function bitwardenExecutable(): string {
  const manifest = require.resolve('@bitwarden/cli/package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
    version: string;
    bin: { bw: string };
  };
  if (pkg.version !== BW_VERSION) throw new ManagerError('wrong-version');
  return join(dirname(manifest), pkg.bin.bw);
}
export class BitwardenVault implements Vault {
  private session: string | null = null;
  constructor(
    private readonly options: {
      directory: string;
      expected: NonNullable<Config['bitwarden']>;
      secrets: SecretStore;
      execute?: (command: Command) => Promise<string>;
    }
  ) {}
  private async execute(
    args: string[],
    extra: { input?: string; env?: NodeJS.ProcessEnv } = {}
  ): Promise<string> {
    return (this.options.execute ?? command)({
      executable: process.execPath,
      args: [bitwardenExecutable(), ...args, '--nointeraction'],
      env: {
        ...baseEnvironment(),
        BITWARDENCLI_APPDATA_DIR: this.options.directory,
        ...(this.session ? { BW_SESSION: this.session } : {}),
        ...extra.env,
      },
      ...(extra.input !== undefined ? { input: extra.input } : {}),
    });
  }
  async status(): Promise<{
    serverUrl: string;
    userEmail: string | null;
    status: string;
  }> {
    const raw = JSON.parse(await this.execute(['status'])) as {
      serverUrl: string;
      userEmail?: string;
      status: string;
    };
    return {
      serverUrl: raw.serverUrl ?? '',
      userEmail: raw.userEmail ?? null,
      status: raw.status,
    };
  }
  private async bound(requireUnlock: boolean): Promise<void> {
    const status = await this.status();
    if (status.status === 'unauthenticated')
      throw new ManagerError('not-authenticated');
    if (status.serverUrl.replace(/\/$/, '') !== this.options.expected.server)
      throw new ManagerError('conflict');
    if (status.userEmail !== this.options.expected.email)
      throw new ManagerError('conflict');
    if (requireUnlock && !this.session) throw new ManagerError('locked');
  }
  async connect(): Promise<void> {
    ensurePrivateDirectory(this.options.directory);
    const status = await this.status();
    if (status.status !== 'unauthenticated') return this.bound(false);
    await this.execute(['config', 'server', this.options.expected.server]);
    const clientId = (
      await this.options.secrets.getRequired(this.options.expected.clientIdRef)
    ).readSecretValue();
    const clientSecret = (
      await this.options.secrets.getRequired(
        this.options.expected.clientSecretRef
      )
    ).readSecretValue();
    await this.execute(['login', '--apikey'], {
      env: { BW_CLIENTID: clientId, BW_CLIENTSECRET: clientSecret },
    });
    await this.bound(false);
  }
  async unlock(masterPassword: string): Promise<void> {
    await this.bound(false);
    const session = (
      await this.execute(
        ['unlock', '--passwordenv', 'PM_MASTER_PASSWORD', '--raw'],
        { env: { PM_MASTER_PASSWORD: masterPassword } }
      )
    ).trim();
    if (!session) throw new ManagerError('locked');
    this.session = session;
    await this.bound(true);
  }
  async folders(): Promise<{ id: string; name: string }[]> {
    await this.sync();
    return JSON.parse(await this.execute(['list', 'folders'])) as {
      id: string;
      name: string;
    }[];
  }
  async folder(id: string): Promise<void> {
    await this.bound(true);
    await this.execute(['get', 'folder', id]);
  }
  async sync(): Promise<void> {
    await this.bound(true);
    await this.execute(['sync']);
  }
  async list(): Promise<VaultItem[]> {
    await this.sync();
    return JSON.parse(await this.execute(['list', 'items'])) as VaultItem[];
  }
  async get(id: string): Promise<VaultItem> {
    await this.sync();
    return JSON.parse(await this.execute(['get', 'item', id])) as VaultItem;
  }
  async create(item: Omit<VaultItem, 'id'>): Promise<VaultItem> {
    await this.bound(true);
    return JSON.parse(
      await this.execute(['create', 'item'], {
        input: Buffer.from(JSON.stringify(item)).toString('base64') + '\n',
      })
    ) as VaultItem;
  }
  async edit(item: VaultItem): Promise<VaultItem> {
    await this.bound(true);
    return JSON.parse(
      await this.execute(['edit', 'item', item.id], {
        input: Buffer.from(JSON.stringify(item)).toString('base64') + '\n',
      })
    ) as VaultItem;
  }
  async health(network: boolean): Promise<unknown> {
    await this.bound(true);
    const help = await this.execute(['report', '--help']);
    if (!help.includes('password-health'))
      throw new ManagerError('unavailable');
    return JSON.parse(
      await this.execute([
        'report',
        'password-health',
        ...(network ? [] : ['--no-check-exposed']),
      ])
    );
  }
  async close(): Promise<void> {
    if (this.session) {
      try {
        await this.execute(['lock']);
      } finally {
        this.session = null;
      }
    }
  }
}
