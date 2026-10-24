import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import type { VaultItem } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
const KNOWN_HEADERS = new Set([
  'name',
  'url',
  'username',
  'password',
  'note',
  'notes',
  'Title',
  'URL',
  'Username',
  'Password',
  'Notes',
  'OTPAuth',
  'otpauth',
  'folder',
  'favorite',
  'type',
  'fields',
  'reprompt',
  'login_uri',
  'login_username',
  'login_password',
  'login_totp',
  'totp',
  'guid',
  'httpRealm',
  'formActionOrigin',
  'usernameField',
  'passwordField',
  'timeCreated',
  'timeLastUsed',
  'timePasswordChanged',
]);
function cell(row: Record<string, string>, ...keys: string[]): string {
  return keys.map((k) => row[k]).find((v) => v !== undefined) ?? '';
}
function validateHeaders(row: Record<string, string>): void {
  if (!['password', 'Password', 'login_password'].some((k) => k in row))
    throw new ManagerError('invalid-input');
  if (!['url', 'URL', 'login_uri'].some((k) => k in row))
    throw new ManagerError('invalid-input');
  if (Object.entries(row).some(([k, v]) => !KNOWN_HEADERS.has(k) && v))
    throw new ManagerError('invalid-input');
}
function csvItem(row: Record<string, string>, index: number): VaultItem {
  validateHeaders(row);
  if (row['type'] && !['login', '1'].includes(row['type']))
    throw new ManagerError('requires-user-action');
  const uri = cell(row, 'url', 'URL', 'login_uri');
  return {
    id: `row-${index}`,
    type: 1,
    name: cell(row, 'name', 'Title') || 'Imported login',
    notes: cell(row, 'note', 'notes', 'Notes'),
    favorite: ['1', 'true'].includes(row['favorite'] ?? 'false'),
    reprompt: Number(row['reprompt'] ?? 0),
    ...(row['fields']
      ? { _unsupported: ['csv-custom-fields-require-json-export'] }
      : {}),
    ...(row['folder'] ? { folderId: row['folder'] } : {}),
    login: {
      username: cell(row, 'username', 'Username', 'login_username'),
      password: cell(row, 'password', 'Password', 'login_password'),
      totp: cell(row, 'OTPAuth', 'otpauth', 'totp', 'login_totp'),
      uris: uri ? [{ uri, match: null }] : [],
    },
  };
}

export async function* csvItems(path: string): AsyncGenerator<VaultItem> {
  let headerSeen = false;
  const stream = createReadStream(path);
  const parser = stream.pipe(
    parse({
      columns: (headers: string[]) => {
        headerSeen = true;
        return csvColumns(headers);
      },
      bom: true,
      max_record_size: 1024 * 1024,
      skip_empty_lines: true,
    })
  );
  stream.on('error', (error) => parser.destroy(error));
  let index = 0;
  try {
    for await (const row of parser)
      yield csvItem(row as Record<string, string>, index++);
    if (!headerSeen) throw new ManagerError('invalid-input');
  } finally {
    stream.destroy();
    parser.destroy();
  }
}
function csvColumns(headers: string[]): string[] {
  if (new Set(headers).size !== headers.length)
    throw new ManagerError('invalid-input');
  validateHeaders(Object.fromEntries(headers.map((header) => [header, ''])));
  return headers;
}
