import type { Runtime, StateStore } from '../domain/ports.ts';
import type { Account, Evidence } from '../domain/model.ts';
import {
  accountFromEvidence,
  matchEvidence,
  mergeEvidence,
} from '../domain/identity.ts';
import {
  effectiveEvidence,
  recordMappings,
  type MappingInput,
} from './decisions.ts';
export function reconcile(
  state: StateStore,
  priorities: string[] = []
): { accounts: number; clues: number } {
  const evidence = effectiveEvidence(state);
  const derived = new Map<string, Account>();
  for (const entry of evidence) {
    const account = accountFromEvidence(entry);
    if (!account) continue;
    const existing = derived.get(account.id);
    derived.set(account.id, existing ? mergeAccount(existing, entry) : account);
  }
  for (const account of derived.values())
    account.auth = authenticationFor(account, evidence);
  state.transaction(() => replaceAccounts(state, derived, priorities));
  return {
    accounts: [...derived.values()].length,
    clues: evidence.filter((e) => !accountFromEvidence(e)).length,
  };
}
function mergeAccount(account: Account, evidence: Evidence): Account {
  const merged = mergeEvidence(account, evidence);
  const known = [account.auth, evidence.auth].filter(
    (auth) => auth !== 'unknown'
  );
  return { ...merged, auth: new Set(known).size === 1 ? known[0]! : 'unknown' };
}
function replaceAccounts(
  state: StateStore,
  derived: Map<string, Account>,
  priorities: string[]
): void {
  const previous = state.list('accounts');
  for (const account of derived.values()) {
    const old = previous.find((a) => a.id === account.id);
    state.put('accounts', restoreStatus(account, old, priorities, state));
  }
  for (const account of previous.filter((a) => !derived.has(a.id))) {
    if (state.list('operations').some((op) => op.accountId === account.id)) {
      state.put('accounts', { ...account, confirmed: false, evidenceIds: [] });
    } else state.remove('accounts', account.id);
  }
}
export function inspectMatches(state: StateStore) {
  const accounts = state.list('accounts').filter((a) => a.confirmed);
  return effectiveEvidence(state).map((e) => ({
    evidenceId: e.id,
    ...matchEvidence(e, accounts),
  }));
}
export function confirmEvidence(
  state: StateStore,
  input: MappingInput,
  runtime: Runtime
): string {
  return state.transaction(() => {
    const decisions = recordMappings(state, [input], runtime);
    reconcile(state);
    return decisions[0]!.id;
  });
}

function authenticationFor(
  account: Account,
  evidence: Evidence[]
): Account['auth'] {
  const known = new Set(
    evidence
      .filter((e) => account.evidenceIds.includes(e.id))
      .map((e) => e.auth)
      .filter((auth) => auth !== 'unknown')
  );
  return known.size === 1 ? [...known][0]! : 'unknown';
}

function restoreStatus(
  account: Account,
  old: Account | undefined,
  priorities: string[],
  state: StateStore
): Account {
  return {
    ...account,
    priority: priorities.includes(account.origin) ? 90 : 50,
    ...verificationStatus(account, old, state),
    mfa: old?.mfa ?? 'unknown',
    recovery: old?.recovery ?? 'unknown',
  };
}

function verificationStatus(
  account: Account,
  old: Account | undefined,
  state: StateStore
) {
  let credential = old?.credential ?? account.credential;
  const fresh = state
    .list('evidence')
    .filter((e) => account.evidenceIds.includes(e.id));
  if (
    credential === 'verified' &&
    fresh.some(
      (e) => e.vaultRevision && e.vaultRevision !== old?.credentialRevision
    )
  )
    credential = 'stale';
  return {
    credential,
    credentialRevision: old?.credentialRevision ?? null,
    credentialVerifiedAt: old?.credentialVerifiedAt ?? null,
  };
}
