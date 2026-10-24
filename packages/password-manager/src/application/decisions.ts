import type {
  AuthMethod,
  Evidence,
  IdentityDecision,
} from '../domain/model.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { originOf, stableId } from '../domain/identity.ts';
export interface MappingInput {
  evidenceId: string;
  origin: string;
  username: string;
  auth?: AuthMethod | undefined;
  identityProvider?: string | null | undefined;
}
export function effectiveEvidence(state: StateStore): Evidence[] {
  const decisions = state.list('decisions').filter((d) => d.active);
  const imports = state.list('imports');
  const resolutions = state.list('candidates');
  return state.list('evidence').map((evidence) => {
    const mapping = imports.find((i) => i.id === evidence.id);
    const resolution = resolutions.find(
      (r) => r.id === evidence.id && r.originalRef === evidence.candidateRef
    );
    const selected = resolution
      ? {
          ...evidence,
          candidateRef: resolution.candidateRef,
          unsupported: resolution.unsupported,
        }
      : evidence;
    return overlay(
      mapping ? { ...selected, vaultId: mapping.vaultId } : selected,
      decisions
    );
  });
}
function overlay(evidence: Evidence, decisions: IdentityDecision[]): Evidence {
  const decision = decisions.find((d) => d.evidenceId === evidence.id);
  if (!decision) return evidence;
  const { identityProvider: _provider, ...rest } = evidence;
  return {
    ...rest,
    origin: decision.origin,
    username: decision.username,
    auth: decision.auth,
    confirmed: true,
    reasons: [...evidence.reasons, 'user-confirmed-mapping'],
    ...(decision.identityProvider
      ? { identityProvider: decision.identityProvider }
      : {}),
  };
}
export function recordMappings(
  state: StateStore,
  inputs: MappingInput[],
  runtime: Runtime
): IdentityDecision[] {
  if (!inputs.length || inputs.length > 1000)
    throw new ManagerError('invalid-input');
  return state.transaction(() =>
    inputs.map((input) => recordOne(state, input, runtime))
  );
}
function recordOne(
  state: StateStore,
  input: MappingInput,
  runtime: Runtime
): IdentityDecision {
  const evidence = state.get('evidence', input.evidenceId);
  if (
    !evidence ||
    originOf(input.origin) !== input.origin ||
    input.username.length > 320
  )
    throw new ManagerError('invalid-input');
  ensureEditable(state, evidence.id);
  const previous = state
    .list('decisions')
    .find((d) => d.evidenceId === evidence.id && d.active);
  if (previous) state.put('decisions', { ...previous, active: false });
  const decision: IdentityDecision = {
    id: runtime.id(),
    evidenceId: evidence.id,
    origin: input.origin,
    username: input.username,
    auth: input.auth ?? evidence.auth,
    identityProvider:
      input.identityProvider ?? evidence.identityProvider ?? null,
    active: true,
    createdAt: runtime.now(),
    previousId: previous?.id ?? null,
  };
  state.put('decisions', decision);
  return decision;
}
export function undoMapping(state: StateStore, id: string): void {
  state.transaction(() => {
    const decision = state.get('decisions', id);
    if (!decision?.active) throw new ManagerError('conflict');
    ensureEditable(state, decision.evidenceId);
    state.put('decisions', { ...decision, active: false });
    const previous = decision.previousId
      ? state.get('decisions', decision.previousId)
      : null;
    if (previous) state.put('decisions', { ...previous, active: true });
  });
}
function ensureEditable(state: StateStore, evidenceId: string): void {
  const accounts = state
    .list('accounts')
    .filter((a) => a.evidenceIds.includes(evidenceId));
  const ids = new Set(accounts.map((a) => a.id));
  const blocked = state
    .list('operations')
    .some(
      (op) =>
        ids.has(op.accountId) &&
        !['completed', 'cancelled', 'failed'].includes(op.state)
    );
  if (blocked) throw new ManagerError('busy');
}
export function aliasMapping(
  state: StateStore,
  accountId: string,
  evidenceId: string
): MappingInput {
  const account = state.get('accounts', accountId);
  if (
    !account?.confirmed ||
    account.id !== stableId(account.origin, account.username)
  )
    throw new ManagerError('invalid-input');
  return {
    evidenceId,
    origin: account.origin,
    username: account.username,
    auth: account.auth,
    identityProvider: account.identityProvider,
  };
}
