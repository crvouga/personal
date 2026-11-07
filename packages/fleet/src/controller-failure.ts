import { diagnostic } from './diagnostics';
import type { FleetDefinition } from './definition';
import type { ControllerReport } from './controller-sync';
import type { Check } from './types';

/** Even preflight failures account for every declared target, without discovery,
 * authentication, filesystem mutations or accidental target substitution.
 */
export function controllerFailure(
  definition: FleetDefinition,
  revision: string | null,
  code: string,
  action: string
): ControllerReport {
  const check: Check = {
    id: 'controller:preflight',
    status: 'fail',
    summary: code,
    remedy: { action },
  };
  return {
    version: 2,
    command: 'fleet-sync',
    execution: 'controller-push',
    ok: false,
    applied: false,
    desiredRevision: revision,
    checks: [check],
    candidates: 0,
    dashboardUrl: null,
    nodes: definition.nodes
      .filter((node) => node.os === 'linux')
      .map((node) => ({
        node: node.id,
        diagnostics: [diagnostic(node.id, check)],
        reachability: 'unknown',
        desiredRevision: revision,
        appliedRevision: null,
        durationMs: 0,
        checks: [
          {
            id: 'rollout:prerequisites',
            status: 'skip',
            summary: code,
            remedy: { action },
          },
        ],
      })),
  };
}
