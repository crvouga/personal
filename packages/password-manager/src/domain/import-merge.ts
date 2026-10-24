import type { VaultItem } from './ports.ts';
import { ManagerError } from './errors.ts';
export type ImportMode =
  'create' | 'merge-metadata' | 'replace-password' | 'preserve';
export function mergeImport(
  current: VaultItem,
  source: VaultItem,
  mode: ImportMode
): VaultItem {
  if (current.login?.username !== source.login?.username)
    throw new ManagerError('conflict');
  if (mode === 'preserve') return current;
  if (!current.login || !source.login) throw new ManagerError('invalid-input');
  validateTotp(current.login, source.login);
  return {
    ...current,
    notes: mergeNotes(current['notes'], source['notes']),
    fields: mergeFields(current.fields ?? [], source.fields ?? []),
    login: mergeLogin(current.login, source.login, mode),
  };
}
function unique<T>(values: T[]): T[] {
  return [
    ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
  ];
}
function mergeNotes(current: unknown, source: unknown): unknown {
  if (!source || current === source) return current;
  if (!current) return source;
  if (typeof current !== 'string' || typeof source !== 'string')
    throw new ManagerError('conflict');
  return current + '\n\n[Imported source notes]\n' + source;
}
function mergeFields(
  current: NonNullable<VaultItem['fields']>,
  source: NonNullable<VaultItem['fields']>
) {
  for (const field of source) {
    if (
      current.some(
        (existing) =>
          existing.name === field.name &&
          JSON.stringify(existing) !== JSON.stringify(field)
      )
    )
      throw new ManagerError('conflict');
  }
  return unique([...current, ...source]);
}

function mergeLogin(
  current: NonNullable<VaultItem['login']>,
  source: NonNullable<VaultItem['login']>,
  mode: ImportMode
): NonNullable<VaultItem['login']> {
  const password =
    mode === 'replace-password' ? source.password : current.password;
  return {
    ...current,
    ...(password === undefined ? {} : { password }),
    totp: current.totp || source.totp || null,
    uris: unique([...(current.uris ?? []), ...(source.uris ?? [])]),
  };
}

function validateTotp(
  current: NonNullable<VaultItem['login']>,
  source: NonNullable<VaultItem['login']>
): void {
  if (current.totp && source.totp && current.totp !== source.totp)
    throw new ManagerError('conflict');
}
