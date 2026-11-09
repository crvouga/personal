import { expect, test } from 'bun:test';
import { managerText } from '../src/fleet-sync-output';
import type { ManagerReport } from '../../fleet/src/manager-sync';

const pass = (id: string) => ({ id, status: 'pass' as const, summary: id });

test('T3 columns report health and manager connectivity checks', () => {
  const report = {
    desiredRevision: 'abc',
    applied: true,
    candidates: 0,
    checks: [],
    nodes: [
      {
        node: 'worker',
        reachability: 'online',
        appliedRevision: 'abc',
        checks: [
          pass('t3:service'),
          pass('worker:t3-health'),
          pass('t3:manager-endpoint'),
          {
            id: 't3:paired-access',
            status: 'fail' as const,
            summary: 'MANAGER_T3_LINK_UNVERIFIED',
          },
        ],
      },
    ],
  } as unknown as ManagerReport;
  const text = managerText(report);
  expect(text).toContain('T3 healthy | T3 connected');
  expect(text).toContain(
    'worker | online | unverified | unverified | pass | fail |'
  );
});
