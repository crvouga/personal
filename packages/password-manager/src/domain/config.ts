import { z } from 'zod';
import { ManagerError } from './errors.ts';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const ref = z
  .string()
  .regex(/^[a-zA-Z0-9._/-]{1,200}$/)
  .refine(
    (value) =>
      !/^(operation|candidate|browser|oauth-pending|restore)\//.test(value)
  );
const origin = z.url().refine((s) => {
  const u = new URL(s);
  return (
    u.protocol === 'https:' &&
    u.origin === s &&
    !u.port &&
    !u.username &&
    !u.password
  );
});
export const sourceSchema = z
  .object({
    id,
    kind: z.enum([
      'bitwarden',
      'csv',
      'bitwarden-json',
      'mbox',
      'eml',
      'gmail',
      'microsoft',
      'imap',
      'inventory',
      'confirmed',
    ]),
    enabled: z.boolean().default(true),
    path: z.string().optional(),
    identity: z.string().max(320).optional(),
    aliases: z.array(z.string().max(320)).default([]),
    includeShared: z.boolean().default(false),
    includeSpamTrash: z.boolean().default(false),
    after: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2000-01-01'),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    query: z.string().max(1000).default(''),
    maxMessages: z.number().int().min(1).max(1_000_000).default(10000),
    clientId: z.string().max(500).optional(),
    clientSecretRef: ref.optional(),
    tokenRef: ref.optional(),
    tenant: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .default('common'),
    host: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .optional(),
    port: z.number().int().min(1).max(65535).default(993),
    credentialRef: ref.optional(),
    scopes: z.array(z.string().max(200)).default([]),
  })
  .strict();
export const configSchema = z
  .object({
    version: z.literal(1),
    secretService: z
      .string()
      .regex(/^workspace\.password-manager(?:\.restore\.[a-f0-9]{32})?$/)
      .default('workspace.password-manager'),
    bitwarden: z
      .object({
        server: origin.default('https://vault.bitwarden.com'),
        email: z.email(),
        clientIdRef: ref.default('bitwarden/client-id'),
        clientSecretRef: ref.default('bitwarden/client-secret'),
        masterPasswordRef: ref.optional(),
      })
      .strict()
      .optional(),
    sources: z.array(sourceSchema).default([]),
    execution: z
      .object({
        autoApply: z.boolean().default(false),
        allowedKinds: z.array(z.enum(['import', 'rotate'])).default([]),
        allowedOrigins: z.array(origin).default([]),
        allowedAccounts: z.array(z.string()).default([]),
        concurrency: z.number().int().min(1).max(4).default(1),
        maxAttempts: z.number().int().min(1).max(3).default(2),
        planLifetimeHours: z.number().min(0.1).max(168).default(24),
      })
      .default(() => ({
        autoApply: false,
        allowedKinds: [],
        allowedOrigins: [],
        allowedAccounts: [],
        concurrency: 1,
        maxAttempts: 2,
        planLifetimeHours: 24,
      })),
    priorityOrigins: z
      .array(origin)
      .default([
        'https://github.com',
        'https://accounts.google.com',
        'https://dash.cloudflare.com',
        'https://railway.com',
      ]),
    retentionDays: z.number().int().min(1).max(3650).default(30),
    backupMaxAgeDays: z.number().int().min(1).max(365).default(7),
    backupPasswordRef: ref.default('backup/independent-password'),
    scheduleHour: z.number().int().min(0).max(23).default(9),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export function parseConfig(value: unknown): Config {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new ManagerError('invalid-config');
  const ids = parsed.data.sources.map((s) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new ManagerError('invalid-config');
  return parsed.data;
}
