import { expect, test } from 'bun:test';
import { controllerText } from '../src/fleet-sync-output';
import type { ControllerReport } from '../../fleet/src/controller-sync';

const pass = (id: string) => ({ id, status: 'pass' as const, summary: id });

test('T3 columns report health and controller connectivity checks', () => {
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
          pass('t3:controller-endpoint'),
          {
            id: 't3:paired-access',
            status: 'fail' as const,
            summary: 'CONTROLLER_T3_LINK_UNVERIFIED',
          },
        ],
      },
    ],
  } as unknown as ControllerReport;
  const text = controllerText(report);
  expect(text).toContain('T3 healthy | T3 connected');
  expect(text).toContain(
    'worker | online | unverified | unverified | pass | fail |'
  );
});
