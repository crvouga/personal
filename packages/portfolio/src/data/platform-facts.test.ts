/**
 * Drift test for the committed platform facts.
 *
 * Recomputes every fact from the monorepo with the same code `bun run facts`
 * uses and compares it with `platform-facts.json`. Inside the Docker build only
 * `packages/portfolio` exists, so the comparison is skipped there — with a
 * message — rather than failing or comparing against nothing.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MONOREPO_ROOT,
  isMonorepoPresent,
  recomputeForCheck,
} from '../../scripts/verification/facts';
import { matrixInstances } from '../../scripts/verification/facts-ci';
import { loadPlatformFacts, parsePlatformFacts } from '../lib/platform-facts';

const present = isMonorepoPresent();
const VOLATILE_TOLERANCE = 0.1;

if (!present) {
  console.warn(
    `[platform-facts] skipping drift test: monorepo files are not under ${MONOREPO_ROOT} ` +
      '(expected inside the Docker build context).'
  );
}

describe('platform-facts.json', () => {
  test('is structurally valid', () => {
    const facts = loadPlatformFacts();
    expect(facts.requiredChecks.length).toBeGreaterThan(0);
    expect(facts.checkGateJobInstances).toBeGreaterThanOrEqual(
      facts.checkGateJobs.length
    );
  });

  test('rejects a malformed file', () => {
    expect(() => parsePlatformFacts({ version: 1 })).toThrow(/malformed/);
    expect(() => parsePlatformFacts([])).toThrow(/malformed/);
  });

  test('expands matrices statically, counting expression matrices once', () => {
    expect(matrixInstances(undefined)).toBe(1);
    expect(matrixInstances({ task: ['quality', 'tests'] })).toBe(2);
    expect(matrixInstances({ os: ['a', 'b'], node: [1, 2, 3] })).toBe(6);
    expect(matrixInstances('${{ fromJSON(needs.plan.outputs.matrix) }}')).toBe(
      1
    );
    expect(matrixInstances({ group: '${{ fromJSON(x) }}' })).toBe(1);
    const shaped = {
      os: ['a', 'b'],
      node: [1, 2],
      exclude: [{ os: 'b', node: 2 }],
      include: [
        { os: 'a', extra: true },
        { os: 'c', node: 9 },
      ],
    };
    // 4 combinations − 1 excluded + 1 new (the first include only extends).
    expect(matrixInstances(shaped)).toBe(4);
    expect(matrixInstances({ include: [{ a: 1 }, { a: 2 }] })).toBe(2);
  });

  test.skipIf(!present)(
    'matches the monorepo (run `bun run facts` after changing what it counts)',
    () => {
      const committed = parsePlatformFacts(
        JSON.parse(
          readFileSync(join(import.meta.dir, 'platform-facts.json'), 'utf8')
        )
      );
      const { recomputed, historySkipped } = recomputeForCheck(committed);
      if (historySkipped !== null) {
        console.warn(
          `[platform-facts] AI trailers not re-verified: ${historySkipped}.`
        );
      }
      // Test counts move with every pull request anywhere in the monorepo; an
      // unrelated PR that adds a test must not fail here. The daily refresh
      // makes them exact again, so drift past 10% means the refresh stopped.
      const tolerance = (
        key: 'workspaceTestFiles' | 'workspaceTestCallSites'
      ): void => {
        const drift =
          Math.abs(recomputed[key] - committed[key]) / committed[key];
        expect(drift).toBeLessThan(VOLATILE_TOLERANCE);
      };
      tolerance('workspaceTestFiles');
      tolerance('workspaceTestCallSites');
      expect({
        ...recomputed,
        workspaceTestFiles: committed.workspaceTestFiles,
        workspaceTestCallSites: committed.workspaceTestCallSites,
      }).toEqual(committed);
    },
    30_000
  );
});
