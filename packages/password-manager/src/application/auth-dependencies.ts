import type { WorkflowContext } from '../domain/ports.ts';
import type { Operation } from '../domain/model.ts';
import { sourceNeedsAttention } from './source-actions.ts';
/** Authentication changes invalidate our confidence in dependent connectors,
 * never erase already collected evidence, plans, cursors or refresh material. */
export function recheckAuthDependencies(
  context: WorkflowContext,
  op: Operation
): void {
  const account = context.state.get('accounts', op.accountId);
  if (!account) return;
  for (const source of context.sources ?? []) {
    const sameIdentity = [source.identity, ...source.aliases].some(
      (identity) => identity?.toLowerCase() === account.username.toLowerCase()
    );
    const provider =
      (source.kind === 'gmail' &&
        account.origin === 'https://accounts.google.com') ||
      (source.kind === 'microsoft' &&
        ['https://account.microsoft.com', 'https://login.live.com'].includes(
          account.origin
        ));
    if (!sameIdentity || !provider) continue;
    const coverage = context.state.get('coverage', source.id);
    if (coverage)
      context.state.put('coverage', {
        ...coverage,
        state: 'requires-user-action',
        error: 'requires-user-action',
      });
    sourceNeedsAttention(
      context.state,
      source,
      'identity-authentication-changed-recheck-connection'
    );
  }
}
