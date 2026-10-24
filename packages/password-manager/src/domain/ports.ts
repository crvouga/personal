import type { SecretStore } from '@pkgs/secret-store';
import type { SourceConfig } from './config.ts';
import type { OperationState, Tables } from './model.ts';

export interface StateStore {
  readonly directory?: string;
  get<K extends keyof Tables>(table: K, id: string): Tables[K] | null;
  list<K extends keyof Tables>(table: K): Tables[K][];
  put<K extends keyof Tables>(table: K, value: Tables[K]): void;
  remove<K extends keyof Tables>(table: K, id: string): void;
  transaction<T>(work: () => T): T;
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export interface Runtime {
  now(): string;
  id(): string;
  password(): string;
}
export interface VaultItem {
  id: string;
  type: number;
  name: string;
  revisionDate?: string;
  organizationId?: string | null;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri: string; match?: number | null }[];
    fido2Credentials?: unknown[];
  };
  fields?: { name: string; value: string; type: number }[];
  [field: string]: unknown;
}
export interface Vault {
  folders?(): Promise<{ id: string; name: string }[]>;
  folder?(id: string): Promise<void>;
  status(): Promise<{
    serverUrl: string;
    userEmail: string | null;
    status: string;
  }>;
  list(): Promise<VaultItem[]>;
  get(id: string): Promise<VaultItem>;
  create(item: Omit<VaultItem, 'id'>): Promise<VaultItem>;
  edit(item: VaultItem): Promise<VaultItem>;
  sync(): Promise<void>;
  health(network: boolean): Promise<unknown>;
}
export interface Credential {
  username: string;
  password: string;
}
export type Verification = 'valid' | 'invalid' | 'challenge' | 'unknown';
export interface SiteAdapter {
  origin: string;
  prepare(credential: Credential): Promise<'ready' | 'challenge'>;
  change(input: {
    old: Credential;
    replacement: string;
  }): Promise<'confirmed' | 'challenge' | 'unknown'>;
  verify(credential: Credential): Promise<Verification>;
  close(): Promise<void>;
}
export interface WorkflowContext {
  secretService?: string;
  sources?: SourceConfig[];
  vaultIdentity?: { server: string; email: string } | null;
  interactive?: boolean;
  deferUserActions?: boolean;
  cancelled?(): boolean;
  maxAttempts?: number;
  state: StateStore;
  secrets: SecretStore;
  vault: Vault;
  runtime: Runtime;
  site(origin: string, accountId: string): Promise<SiteAdapter>;
  checkpoint?(state: OperationState): void;
}
