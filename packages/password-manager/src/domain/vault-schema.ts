import { z } from 'zod';
import type { VaultItem } from './ports.ts';
import { ManagerError } from './errors.ts';
const login = z
  .object({
    username: z.string().nullable().optional(),
    password: z.string().nullable().optional(),
    totp: z.string().nullable().optional(),
    uris: z
      .array(
        z.object({ uri: z.string(), match: z.number().nullable().optional() })
      )
      .nullable()
      .optional(),
    fido2Credentials: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();
const item = z
  .object({
    id: z.string(),
    type: z.number().int(),
    name: z.string(),
    login: login.nullable().optional(),
  })
  .passthrough();
export function validateVaultItems(value: unknown): VaultItem[] {
  const parsed = z.array(item).safeParse(value);
  if (!parsed.success) throw new ManagerError('invalid-input');
  return value as VaultItem[];
}
