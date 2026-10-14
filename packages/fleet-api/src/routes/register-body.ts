import { NODE_ID_PATTERN, NODE_SECRET_PATTERN } from '../auth/node-credential';
import {
  isRecord,
  readString,
  requireString,
  type Problems,
} from '../domain/heartbeat-fields';
import { isRole, type Role } from '../types';

export interface RegisterBody {
  readonly nodeId: string;
  readonly role: Role;
  readonly hostname: string;
  readonly secret: string;
  readonly roleToken: string | undefined;
}

export type RegisterResult =
  | { readonly ok: true; readonly value: RegisterBody }
  | { readonly ok: false; readonly errors: readonly string[] };

const HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const MAX_ROLE_TOKEN = 512;

export function validateRegister(input: unknown): RegisterResult {
  if (!isRecord(input))
    return { ok: false, errors: ['body must be a JSON object'] };
  const problems: Problems = { list: [] };
  const nodeId = requireString(problems, 'nodeId', input['nodeId'], {
    max: 64,
    pattern: NODE_ID_PATTERN,
  });
  const hostname = requireString(problems, 'hostname', input['hostname'], {
    max: 63,
    pattern: HOSTNAME,
  });
  const secret = requireString(problems, 'secret', input['secret'], {
    max: 64,
    pattern: NODE_SECRET_PATTERN,
  });
  const roleToken = readString(problems, 'roleToken', input['roleToken'], {
    max: MAX_ROLE_TOKEN,
  });
  const role = input['role'];
  if (!isRole(role)) problems.list.push('role must be one of the known roles');
  if (problems.list.length > 0 || !isRole(role))
    return { ok: false, errors: problems.list };
  return {
    ok: true,
    value: {
      nodeId,
      role,
      hostname,
      secret,
      roleToken: roleToken ?? undefined,
    },
  };
}
