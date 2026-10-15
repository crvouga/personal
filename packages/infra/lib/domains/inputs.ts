import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** A recovered foundation input bundle stays private and supplies only known inputs. */
export function foundationInputs(repo: string, env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const configured = env['DOMAIN_TOFU_INPUTS_FILE'];
  const path = configured ? resolve(repo, configured) : join(repo, '.domain-migration/tofu-inputs.json');
  if (!existsSync(path)) {
    if (configured) throw new Error('Configured private OpenTofu input file is missing');
    return {};
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('OpenTofu input bundle must be an owner-only regular file (chmod 600), without symlinks');
  if (info.size > 1048576) throw new Error('OpenTofu input bundle exceeds the expected size');
  const allowed = new Set(['state_passphrase', 'state_access_key', 'state_secret_key', 'cloudflare_api_token', 'cloudflare_account_id', 'cloudflare_zone_id', 'railway_token', 'github_token', 'planetscale_service_token_id', 'planetscale_service_token', 'vault_inputs', 'vault_image_tag', 'schema_dev_url', 'migration_ready']);
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const result: Record<string, string> = {};
    for (const [key, input] of Object.entries(value)) {
      if (!allowed.has(key)) continue;
      if (key === 'migration_ready' ? typeof input !== 'boolean' : typeof input !== 'string' || !input.trim()) throw new Error();
      result[`TF_VAR_${key}`] = String(input);
    }
    return result;
  } catch { throw new Error('OpenTofu input bundle has invalid foundation inputs; contents withheld'); }
}

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
