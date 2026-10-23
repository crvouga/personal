import type { Ui, Inventory } from './types';
import type { Fill, VaultInputs } from '../vault-inputs/model';

export const inventory: Inventory = {
  vault: {
    kv_keys: [
      {
        name: 'GOOGLE_OAUTH_CLIENT_ID',
        configs: ['dev', 'prd'],
        required: true,
      },
      {
        name: 'GOOGLE_OAUTH_CLIENT_SECRET',
        configs: ['dev', 'prd'],
        required: true,
      },
      { name: 'OPENAI_API_KEY', configs: ['dev', 'prd'] },
      { name: 'RAILWAY_TOKEN', configs: ['dev', 'prd'] },
      { name: 'VAULT_TOKEN', configs: ['dev', 'prd'] },
      {
        name: 'AUTH_RELAY_SETUP_TOKEN_PRODUCTION',
        configs: ['prd'],
        generated: true,
      },
    ],
  },
  auth_relay: {
    enabled: true,
    live: true,
    instances: {
      production: {
        hostname: 'auth.example.test',
        realm: 'projects',
        vault_config: 'prd',
      },
      nonproduction: {
        hostname: 'auth-dev.example.test',
        realm: 'projects-dev',
        vault_config: 'dev',
      },
    },
  },
};
export const before: VaultInputs = {
  secrets: {
    dev: {
      GOOGLE_OAUTH_CLIENT_ID: '123-old.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-old-dev',
      KEEP: 'private-dev',
    },
    prd: {
      GOOGLE_OAUTH_CLIENT_ID: '123-old.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-old-prd',
      KEEP: 'private-prd',
    },
  },
  admin_passwords: { operator: 'private-password' },
  fleet_age_keys: { ci: 'private-age-key' },
};
export const fills: Fill[] = ['prd', 'dev'].flatMap((config) => [
  {
    config: config as 'prd' | 'dev',
    name: 'GOOGLE_OAUTH_CLIENT_ID',
    value: '456-new.apps.googleusercontent.com',
  },
  {
    config: config as 'prd' | 'dev',
    name: 'GOOGLE_OAUTH_CLIENT_SECRET',
    value: 'GOCSPX-new-secret',
  },
]);

export function fakeUi(
  overrides: Partial<Ui> = {}
): Ui & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    say: (message) => {
      messages.push(message);
    },
    choose: async (_message, choices) => choices[0].value,
    scopes: async () => ['prd', 'dev'],
    key: async () => 'OPENAI_API_KEY',
    value: async (name) =>
      name === 'GOOGLE_OAUTH_CLIENT_ID'
        ? '456-new.apps.googleusercontent.com'
        : 'GOCSPX-new-secret',
    confirm: async () => true,
    task: async (_message, action) => action(),
    review: (_before, selected) => {
      messages.push(
        selected.map((fill) => `${fill.config}.${fill.name}`).join('\n')
      );
    },
    ...overrides,
  };
}
