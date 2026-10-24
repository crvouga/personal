import { createHash } from 'node:crypto';
import { getDomain } from 'tldts';
import type { Account, Evidence } from './model.ts';
import { ManagerError } from './errors.ts';

/** Never hash passwords into ordinary metadata. This is for public identities. */
export function stableId(...parts: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 32);
}
export function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.port || !url.hostname.includes('.')) return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function suggestedDomain(host: string): string | null {
  return getDomain(host, { allowPrivateDomains: true });
}
export function accountFromEvidence(evidence: Evidence): Account | null {
  if (!evidence.confirmed || !evidence.origin || evidence.username === null)
    return null;
  const id = stableId(evidence.origin, evidence.username);
  return {
    id,
    origin: evidence.origin,
    username: evidence.username,
    confirmed: true,
    auth: evidence.auth,
    identityProvider: evidence.identityProvider ?? null,
    evidenceIds: [evidence.id],
    vaultIds: evidence.vaultId ? [evidence.vaultId] : [],
    credential: evidence.vaultId ? 'stored' : 'unknown',
    recovery: 'unknown',
    mfa: 'unknown',
    priority: 50,
  };
}
export function mergeEvidence(account: Account, evidence: Evidence): Account {
  if (
    account.origin !== evidence.origin ||
    account.username !== evidence.username
  ) {
    throw new ManagerError('conflict');
  }
  return {
    ...account,
    evidenceIds: [...new Set([...account.evidenceIds, evidence.id])],
    vaultIds: [
      ...new Set([
        ...account.vaultIds,
        ...(evidence.vaultId ? [evidence.vaultId] : []),
      ]),
    ],
  };
}
export function matchEvidence(
  evidence: Evidence,
  accounts: Account[]
): {
  exact: string[];
  possible: string[];
  status: 'exact' | 'possible' | 'conflict' | 'unmatched';
} {
  const exact = accounts
    .filter(
      (a) =>
        evidence.confirmed &&
        a.origin === evidence.origin &&
        a.username === evidence.username
    )
    .map((a) => a.id);
  const possible = accounts
    .filter(
      (a) =>
        evidence.domain &&
        suggestedDomain(new URL(a.origin).hostname) ===
          suggestedDomain(evidence.domain)
    )
    .map((a) => a.id);
  const status =
    exact.length > 1
      ? 'conflict'
      : exact.length === 1
        ? 'exact'
        : possible.length
          ? 'possible'
          : 'unmatched';
  return { exact, possible, status };
}
