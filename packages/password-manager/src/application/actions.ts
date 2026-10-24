import type { Runtime, StateStore } from '../domain/ports.ts';
import type { UserAction } from '../domain/model.ts';
import { scopedCommand } from '../domain/commands.ts';
import { stableId } from '../domain/identity.ts';
import { ManagerError } from '../domain/errors.ts';
export type ActionInput = Omit<UserAction, 'id' | 'status' | 'attestation'>;
export function requireAction(
  state: StateStore,
  input: ActionInput
): UserAction {
  const id = stableId(
    input.operationId ?? '',
    input.sourceId ?? '',
    input.step
  );
  const existing = state.get('actions', id);
  const action: UserAction = {
    ...scopeAction(state, input),
    id,
    status: 'pending',
    attestation: 'none',
  };
  if (existing?.status === 'skipped') return existing;
  state.put('actions', action);
  return action;
}
export function operationAction(input: {
  operationId: string;
  accountId: string;
  runId: string | null;
  step: string;
  destination: string;
  reason: string;
  instructions: string[];
}): ActionInput {
  return {
    ...input,
    sourceId: null,
    prerequisites: [],
    expiresAt: null,
    detection:
      'The adapter rechecks the actual operation and performs independent credential verification.',
    resume: `bun run password-manager recover ${input.operationId}`,
    alternative:
      'Keep this operation pending and use the provider official account recovery flow if sign-in is unavailable.',
  };
}
export function skipAction(
  state: StateStore,
  id: string,
  reason: string,
  runtime: Runtime
): void {
  const action = state.get('actions', id);
  if (
    !action ||
    !['deferred', 'unsupported', 'not-my-account'].includes(reason)
  )
    throw new ManagerError('invalid-input');
  state.put('actions', {
    ...action,
    status: 'skipped',
    reason: `user-${reason}`,
    expiresAt: runtime.now(),
  });
}

function scopeAction(state: StateStore, action: ActionInput): ActionInput {
  if (!state.directory) return action;
  const scoped = (value: string) => scopedCommand(value, state.directory!);
  return {
    ...action,
    resume: scoped(action.resume),
    instructions: action.instructions.map(scoped),
    alternative: scoped(action.alternative),
  };
}
