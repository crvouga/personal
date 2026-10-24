import type { Coverage } from '../domain/model.ts';
export function coverageStatus(coverage: Coverage[]): string {
  const enabled = coverage.filter((c) => c.state !== 'skipped');
  if (!enabled.length) return 'requires-user-action';
  if (enabled.every((c) => c.state === 'failed')) return 'failed';
  if (enabled.some((c) => ['failed', 'incomplete'].includes(c.state)))
    return 'partial';
  if (enabled.some((c) => c.state !== 'scanned')) return 'requires-user-action';
  return 'completed';
}
