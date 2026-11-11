import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** This repository now runs its fleet from dev-fleet at the revision pinned
 * in `fleet.revision`. The copy of the fleet code still in this repository is
 * older and would undo that on every machine, so its mutating commands refuse
 * to run from a checkout that has the pin.
 */
export function movedToDevFleet(workspace: string): boolean {
  return (
    process.env['NODE_ENV'] !== 'test' &&
    existsSync(join(workspace, 'fleet.revision'))
  );
}

export const MOVED_REMEDY =
  'The fleet runs from dev-fleet now. Use: bash scripts/dev/project-action.sh fleet-sync (or infra-cliproxy for the proxy).';
