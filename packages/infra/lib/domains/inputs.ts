import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One private batch input, never a command argument or a log/report value. */
export function ownerCodes(repo: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (env['TF_VAR_domain_auth_codes']) return env['TF_VAR_domain_auth_codes'];
  const configured = env['DOMAIN_AUTH_CODES_FILE'];
  const path = configured ? resolve(repo, configured) : join(repo, '.domain-migration/auth-codes.json');
  if (!existsSync(path)) {
    if (configured) throw new Error('Configured private authorization-code file is missing');
    return undefined;
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Authorization-code input must be an owner-only regular file (chmod 600), without symlinks');
  if (info.size > 65536) throw new Error('Authorization-code input exceeds the expected batch size');
  const value = readFileSync(path, 'utf8');
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((code) => typeof code !== 'string' || !code.trim())) throw new Error();
  } catch { throw new Error('Authorization-code input must be a domain-to-raw-code JSON object; contents withheld'); }
  return value;
}
