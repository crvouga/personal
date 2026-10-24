import { SecretString, type SecretStore } from '@pkgs/secret-store';
import type { VaultItem, Vault } from '../domain/ports.ts';
export class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async getRequired(name: string): Promise<SecretString> {
    const result = await this.getOptional(name);
    if (!result) throw new Error('synthetic missing secret');
    return result;
  }
  async getOptional(name: string): Promise<SecretString | null> {
    const value = this.values.get(name);
    return value === undefined ? null : new SecretString('fixture', value);
  }
  async getRequiredMany(
    names: readonly string[]
  ): Promise<Record<string, SecretString>> {
    return Object.fromEntries(
      await Promise.all(names.map(async (n) => [n, await this.getRequired(n)]))
    );
  }
  async getOptionalMany(
    names: readonly string[]
  ): Promise<Record<string, SecretString | null>> {
    return Object.fromEntries(
      await Promise.all(names.map(async (n) => [n, await this.getOptional(n)]))
    );
  }
  async setSecret(name: string, value: string): Promise<void> {
    this.values.set(name, value);
  }
}
export function fakeVault(initial: VaultItem[]) {
  const items = structuredClone(initial);
  let creates = 0;
  let edits = 0;
  const vault: Vault = {
    status: async () => ({
      serverUrl: 'https://vault.bitwarden.com',
      userEmail: 'synthetic@example.test',
      status: 'unlocked',
    }),
    list: async () => structuredClone(items),
    get: async (id) => structuredClone(items.find((i) => i.id === id)!),
    create: async (item) => {
      creates++;
      const saved = {
        ...structuredClone(item),
        id: `created-${creates}`,
      } as VaultItem;
      items.push(saved);
      return structuredClone(saved);
    },
    edit: async (item) => {
      edits++;
      items[items.findIndex((i) => i.id === item.id)] = structuredClone(item);
      return structuredClone(item);
    },
    sync: async () => {},
    health: async () => [],
  };
  return { vault, items, creates: () => creates, edits: () => edits };
}
