import { expect, test } from 'bun:test';
import type { HealthReport } from '../../packages/infra/lib/health/report';
import { ADVICE, fixers } from './registry';
import { findingsOf, NO_GUIDED_FIX, triage } from './triage';

const report = (
  groups: Record<string, [string, 'pass' | 'warn' | 'fail' | 'skip', string][]>
): HealthReport => ({
  zone: 'example.dev',
  startedAt: '',
  durationMs: 0,
  groups: Object.entries(groups).map(([id, results]) => ({
    id,
    title: id,
    durationMs: 0,
    results: results.map(([name, status, detail]) => ({
      name,
      status,
      detail,
    })),
  })),
});

const registry = fixers({ dryRun: true, given: {} });

test('only non-passing results become findings', () => {
  const found = findingsOf(
    report({
      dns: [
        ['a', 'pass', ''],
        ['b', 'fail', 'x'],
      ],
    })
  );
  expect(found.map((f) => f.check)).toEqual(['b']);
});

test('routes missing Vault fields and failed CI to their fixers', () => {
  const { fixes, manual } = triage(
    findingsOf(
      report({
        auth: [
          [
            'production credentials',
            'fail',
            'secret/data/personal/prd: missing or empty X',
          ],
        ],
        secrets: [['prd', 'fail', 'missing or empty required: Y']],
        github: [['pipeline ci.yml', 'fail', 'run #1 failed']],
        vault: [['seal', 'fail', 'sealed']],
      })
    ),
    registry,
    ADVICE
  );
  expect(fixes.map((f) => [f.fixer.id, f.findings.length])).toEqual([
    ['vault-inputs', 2],
    ['ci-rerun', 1],
  ]);
  expect(manual.map((m) => m.finding.check)).toEqual(['seal']);
  expect(manual[0]?.advice).toBe(NO_GUIDED_FIX);
});

test('skips and unmatched failures get advice, never a fixer', () => {
  const { fixes, manual } = triage(
    findingsOf(
      report({
        dns: [['x', 'skip', 'Cloudflare token required']],
        tunnels: [['llm.example.dev', 'warn', 'connector offline (HTTP 530)']],
        github: [
          [
            'publisher a/b',
            'fail',
            '.github/workflows/publish.yml is missing on main',
          ],
        ],
      })
    ),
    registry,
    ADVICE
  );
  expect(fixes).toEqual([]);
  expect(manual.map((m) => m.advice)).toEqual([
    expect.stringContaining('Not checked'),
    expect.stringContaining('cloudflared'),
    expect.stringContaining('publisher workflow'),
  ]);
});
