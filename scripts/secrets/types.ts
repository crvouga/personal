import type { KvKey } from '../vault-secrets-tfvars';
import type { Config, Fill, VaultInputs } from '../vault-inputs/model';

export type SecretKey = KvKey & { used_by?: string[] };
export type Inventory = {
  vault: { kv_keys: SecretKey[] };
  auth_relay: {
    enabled: boolean;
    live: boolean;
    instances: Record<
      string,
      { hostname: string; realm: string; vault_config: Config }
    >;
  };
};
export type Choice<T> = { name: string; value: T; description?: string };
export interface Ui {
  say(message: string): void;
  choose<T>(message: string, choices: Choice<T>[]): Promise<T>;
  scopes(): Promise<Config[]>;
  key(
    keys: SecretKey[],
    inputs: VaultInputs,
    configs: Config[]
  ): Promise<string>;
  value(name: string, scope: string, present: boolean): Promise<string>;
  confirm(message: string, fallback?: boolean): Promise<boolean>;
  task<T>(message: string, action: () => Promise<T>): Promise<T>;
  review(inputs: VaultInputs, fills: Fill[]): void;
}
export interface Session {
  load(): Promise<VaultInputs>;
  update(
    before: VaultInputs,
    next: VaultInputs,
    fills: Fill[],
    preview: boolean
  ): Promise<void>;
  close(): void;
}
