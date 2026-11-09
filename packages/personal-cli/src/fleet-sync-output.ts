import type { ManagerReport } from '../../fleet/src/manager-sync';
import type { Check } from '../../fleet/src/types';
const T3_HEALTH = [
  't3:service',
  't3:policy',
  't3:private-route',
  'worker:t3-recovery',
  'worker:t3-health',
  'worker:service-recovery',
];
const T3_CONNECTED = ['t3:manager-endpoint', 't3:paired-access'];
export function managerText(report: ManagerReport): string {
  const lines = [
    `Approved revision: ${report.desiredRevision ?? 'not selected'}`,
    ...report.checks
      .filter((check) => check.status !== 'pass')
      .map(
        (check) =>
          `${check.id}: ${check.summary}${check.remedy ? ` — ${check.remedy.action}` : ''}`
      ),
    'Node | Tailscale | SSH | Ubuntu/config | T3 healthy | T3 connected | Gateway | Beszel | Outcome | Applied revision',
    '--- | --- | --- | --- | --- | --- | --- | --- | --- | ---',
  ];
  for (const node of report.nodes) {
    const outcome = nodeOutcome(node.checks, report.applied);
    lines.push(
      `${node.node} | ${node.reachability} | ${group(node.checks, ['ssh:'])} | ${group(node.checks, ['ubuntu:baseline', 'configuration:apply'])} | ${group(node.checks, T3_HEALTH)} | ${group(node.checks, T3_CONNECTED)} | ${group(node.checks, ['provider:', 'proxy:'])} | ${group(node.checks, ['beszel:'])} | ${outcome} | ${node.appliedRevision ?? 'unverified'}`
    );
    for (const check of node.checks.filter((check) => check.status !== 'pass'))
      lines.push(
        `  ${node.node}: ${check.id} — ${check.summary}${check.remedy ? ` ${check.remedy.action}` : ''}`
      );
  }
  if (report.dashboardUrl)
    lines.push(`Beszel dashboard: ${report.dashboardUrl}`);
  lines.push(
    `Discovery candidates: ${report.candidates} (not managed).`,
    report.applied
      ? 'Application and readiness are separate; unresolved checks remain above.'
      : 'No node deployment was performed.'
  );
  return lines.join('\n');
}
function group(checks: Check[], prefixes: string[]): string {
  const selected = checks.filter((check) =>
    prefixes.some((prefix) => check.id.startsWith(prefix))
  );
  if (!selected.length) return 'unverified';
  if (selected.some((check) => check.status === 'fail')) return 'fail';
  return selected.every((check) => check.status === 'pass')
    ? 'pass'
    : 'pending';
}

function nodeOutcome(checks: Check[], applied: boolean): string {
  if (checks.length && checks.every((check) => check.status === 'pass'))
    return applied ? 'checks passed' : 'preview only';
  return checks.some((check) => check.status === 'fail')
    ? 'action required'
    : 'pending';
}
