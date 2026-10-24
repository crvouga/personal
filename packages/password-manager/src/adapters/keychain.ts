import { fileURLToPath } from 'node:url';
import { command, type Command } from './process.ts';
import { SecretString, type SecretStore } from '@pkgs/secret-store';
import { ManagerError } from '../domain/errors.ts';

/** Implements the existing port. Linux MUST persist through Secret Service. */
export class OsSecrets implements SecretStore {
  constructor(
    private readonly service = 'workspace.password-manager',
    private readonly execute: (input: Command) => Promise<string> = command
  ) {}
  async checkDriver(): Promise<void> {
    try {
      if ((await this.request('probe', 'doctor/native-driver')) !== 'available')
        throw new ManagerError('unavailable');
    } catch {
      throw new ManagerError('unavailable');
    }
  }
  private async request(
    operation: string,
    name: string,
    value?: string
  ): Promise<string | null> {
    if (!/^[a-zA-Z0-9._/-]{1,200}$/.test(name))
      throw new ManagerError('invalid-input');
    try {
      const output = await this.execute({
        executable: process.execPath,
        args: [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('./keyring-worker.ts', import.meta.url)),
        ],
        input: JSON.stringify({
          service: this.service,
          operation,
          name,
          value,
        }),
        timeoutMs: 10_000,
        maxBytes: 2 * 1024 * 1024,
      });
      const result: unknown = JSON.parse(output);
      if (result !== null && typeof result !== 'string')
        throw new ManagerError('unavailable');
      return result;
    } catch {
      throw new ManagerError('locked');
    }
  }
  async getRequired(name: string): Promise<SecretString> {
    const value = await this.getOptional(name);
    if (!value) throw new ManagerError('missing');
    return value;
  }
  async getOptional(name: string): Promise<SecretString | null> {
    try {
      const value = await this.request('get', name);
      return value === null
        ? null
        : new SecretString('password-manager', value);
    } catch {
      throw new ManagerError('locked');
    }
  }
  async getRequiredMany(
    names: readonly string[]
  ): Promise<Record<string, SecretString>> {
    const entries = await Promise.all(
      names.map(async (n) => [n, await this.getRequired(n)] as const)
    );
    return Object.fromEntries(entries);
  }
  async getOptionalMany(
    names: readonly string[]
  ): Promise<Record<string, SecretString | null>> {
    const entries = await Promise.all(
      names.map(async (n) => [n, await this.getOptional(n)] as const)
    );
    return Object.fromEntries(entries);
  }
  async setSecret(name: string, value: string): Promise<void> {
    await this.request('set', name, value);
  }
  async remove(name: string): Promise<void> {
    await this.request('remove', name);
  }
}
