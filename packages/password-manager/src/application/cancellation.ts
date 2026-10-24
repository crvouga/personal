import type { WorkflowContext } from '../domain/ports.ts';
import type { Operation } from '../domain/model.ts';
import { pause, transition } from './rotation-state.ts';
export function isCancelled(context: WorkflowContext, op: Operation): boolean {
  return Boolean(
    context.cancelled?.() ||
    (op.runId && context.state.get('runs', op.runId)?.cancelled)
  );
}
export function cancelOperation(
  context: WorkflowContext,
  op: Operation
): Operation {
  if (op.submittedAt)
    return pause(
      context,
      { ...op, state: 'outcome_unknown' },
      'cancelled-after-submission'
    );
  return transition(context, { ...op, resumeState: op.state }, 'cancelled');
}
