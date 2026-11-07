import type { Check, FleetNode, Runner } from '../types';
import { shellQuote, sshArgs, sshFailure } from '../ssh';
import { validCheck, cleanCheck } from '../protocol';
import { record } from '../config';
import { isRevision } from '../machine/state';
import type { AgentEnrollment } from './enroll';

/** Only node-specific agent credentials cross SSH; hub account credentials stay
 * on the controller. The installed source and remote operation lock are reused.
 */
export async function installRemoteAgent(
  node: FleetNode,
  revision: string,
  enrollment: AgentEnrollment | { mode: 'hub'; hubUrl: string },
  run: Runner
): Promise<Check[]> {
  if (!isRevision(revision)) throw new Error('BESZEL_REVISION');
  const root = `"$HOME/.local/share/personal/fleet/revisions/${revision}"`;
  const command = `cd ${root} && exec 9>"$HOME/.local/share/personal/fleet/remote-operation.lock" && flock -n 9 && trap '' HUP && exec "$HOME/.local/bin/mise" exec --locked bun -- bun ${shellQuote('packages/workstation/cli/lib/monitoring/apply.ts')}`;
  const result = await run([...sshArgs(node), command], {
    input: JSON.stringify({ ...enrollment, node: node.id, revision }),
    timeoutMs: 360_000,
  });
  if (!result.ok) return [sshFailure(result)];
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (
      record(value) &&
      value['version'] === 1 &&
      Array.isArray(value['checks']) &&
      value['checks'].length > 0 &&
      value['checks'].length <= 20 &&
      value['checks'].every(validCheck)
    )
      return value['checks'].map(cleanCheck);
  } catch {
    /* Never expose native output or credentials. */
  }
  return [
    {
      id: 'beszel:protocol',
      status: 'fail',
      summary: 'BESZEL_REMOTE_EVIDENCE_INVALID',
    },
  ];
}
