/**
 * The machines in packages/fleet, as the fleet API sees them.
 *
 * Read-only: one authenticated `GET /v1/nodes`. The API being up is the
 * services group's job; this group answers whether the nodes it serves are
 * reporting. An approved node that stopped reporting fails; degraded or
 * unapproved nodes warn.
 */
import {
  asRecord,
  asStrings,
  errorMessage,
  getJson,
  type HealthContext,
} from './context.js';
import { fail, pass, skip, warn, type CheckResult } from './report.js';

const NAME = 'fleet nodes';
const API_SERVICE_ID = 'fleet-api';
const TOKEN_VARIABLE = 'FLEET_ADMIN_TOKEN';
/** Longest list of names a detail line carries before it summarizes the rest. */
const MAX_NAMES = 6;

export type FleetNode = {
  readonly label: string;
  readonly status: string;
  readonly rolledBack: boolean;
  readonly failedUnits: readonly string[];
  readonly readinessIssues: readonly string[] | null;
  readonly syncFailure: string | null;
};

/** Reads one NodeView defensively; anything that is not an object with a status is dropped. */
export function readNode(value: unknown): FleetNode | undefined {
  const node = asRecord(value);
  const status = node['status'];
  if (typeof status !== 'string') return undefined;
  const facts = asRecord(node['facts']);
  const text = (field: string): string => {
    const entry = node[field];
    return typeof entry === 'string' ? entry : '';
  };
  return {
    label:
      text('label') || text('hostname') || text('id').slice(0, 4) || 'unnamed',
    status,
    rolledBack: asRecord(facts['sync'])['rolledBack'] === true,
    failedUnits: asStrings(facts['failedUnits']),
    readinessIssues: Array.isArray(asRecord(facts['readiness'])['issues']) ? asStrings(asRecord(facts['readiness'])['issues']) : null,
    syncFailure: typeof asRecord(facts['sync'])['healthFailure'] === 'string' ? String(asRecord(facts['sync'])['healthFailure']) : null,
  };
}

/** The API answers an array of NodeView; tolerate a `{ nodes }` envelope. */
export function readNodes(body: unknown): readonly FleetNode[] | undefined {
  const list = Array.isArray(body) ? body : asRecord(body)['nodes'];
  if (!Array.isArray(list)) return undefined;
  return list
    .map(readNode)
    .filter((node): node is FleetNode => node !== undefined);
}

function names(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_NAMES).join(', ');
  return labels.length > MAX_NAMES
    ? `${shown} and ${labels.length - MAX_NAMES} more`
    : shown;
}

/** Retired and rejected nodes are decisions, not problems; offline nodes show only that they are offline. */
function degraded(nodes: readonly FleetNode[]): readonly string[] {
  const live = nodes.filter(
    (node) => node.status === 'online' || node.status === 'stale'
  );
  const withUnits = live.filter((node) => node.failedUnits.length > 0);
  const groups: readonly (readonly [string, readonly string[]])[] = [
    [
      'stale',
      nodes.filter((node) => node.status === 'stale').map((node) => node.label),
    ],
    [
      'pending approval',
      nodes
        .filter((node) => node.status === 'pending')
        .map((node) => node.label),
    ],
    [
      'rolled back',
      live.filter((node) => node.rolledBack).map((node) => node.label),
    ],
    [
      'failed units',
      withUnits.map((node) => `${node.label} (${names(node.failedUnits)})`),
    ],
    ['readiness unknown', live.filter((node) => node.readinessIssues === null).map((node) => node.label)],
    ['not ready', live.filter((node) => node.readinessIssues !== null && node.readinessIssues.length > 0).map((node) => `${node.label} (${names(node.readinessIssues ?? [])})`)],
    ['sync failure', live.filter((node) => node.syncFailure).map((node) => `${node.label} (${node.syncFailure})`)],
  ];
  return groups
    .filter(([, labels]) => labels.length > 0)
    .map(([reason, labels]) => `${reason}: ${names(labels)}`);
}

function counts(nodes: readonly FleetNode[]): string {
  if (nodes.length === 0) return 'no nodes have registered yet';
  const byStatus = new Map<string, number>();
  for (const node of nodes)
    byStatus.set(node.status, (byStatus.get(node.status) ?? 0) + 1);
  const parts = [...byStatus].map(([status, count]) => `${count} ${status}`);
  return `${nodes.length} node(s): ${parts.join(', ')}`;
}

/** Judges a node list: fail when an approved node is offline, warn on anything degraded. */
export function judgeNodes(nodes: readonly FleetNode[]): CheckResult {
  if (nodes.length === 0) return warn(NAME, 'no nodes have registered yet; installed runner readiness is unverified');
  const offline = nodes
    .filter((node) => node.status === 'offline')
    .map((node) => node.label);
  const problems = [
    ...(offline.length > 0 ? [`offline: ${names(offline)}`] : []),
    ...degraded(nodes),
  ];
  if (problems.length === 0) return pass(NAME, counts(nodes));
  const detail = `${problems.join('; ')} (${counts(nodes)})`;
  return offline.length > 0 ? fail(NAME, detail) : warn(NAME, detail);
}

/** The environment wins; otherwise the production KV document holds the generated token. */
async function adminToken(ctx: HealthContext): Promise<string | undefined> {
  const fromEnv = ctx.env[TOKEN_VARIABLE]?.trim();
  if (fromEnv) return fromEnv;
  const doc = await ctx.kv('prd');
  return doc.ok ? doc.data[TOKEN_VARIABLE]?.trim() || undefined : undefined;
}

export async function checkFleetNodes(
  ctx: HealthContext
): Promise<readonly CheckResult[]> {
  const service = ctx.config.services.find(
    (candidate) => candidate.id === API_SERVICE_ID
  );
  if (!service?.hostname)
    return [skip(NAME, `${API_SERVICE_ID} is not declared in the inventory`)];
  const token = await adminToken(ctx);
  if (!token)
    return [
      skip(
        NAME,
        `no ${TOKEN_VARIABLE}: export it or read the production Vault document`
      ),
    ];
  const url = `https://${service.hostname}/v1/nodes`;
  try {
    const res = await getJson(ctx, url, { Authorization: `Bearer ${token}` });
    if (res.status === 401 || res.status === 403) {
      return [
        fail(
          NAME,
          `${url} rejected ${TOKEN_VARIABLE} (HTTP ${res.status}); the token in use no longer matches the service`
        ),
      ];
    }
    if (res.status !== 200)
      return [
        fail(NAME, `fleet API is down: ${url} answered HTTP ${res.status}`),
      ];
    const nodes = readNodes(res.body);
    if (!nodes) return [fail(NAME, `${url} did not return a node list`)];
    return [judgeNodes(nodes)];
  } catch (err) {
    return [
      fail(NAME, `fleet API is down: ${url} unreachable: ${errorMessage(err)}`),
    ];
  }
}
