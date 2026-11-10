/**
 * Drift test for the committed hosted index (`/hosted/`). Recomputes it from
 * the OpenTofu inventory with the same code `bun run hosted-index` uses.
 * Inside the Docker build only `packages/portfolio` exists, so the comparison
 * is skipped there.
 */

import { describe, expect, test } from 'bun:test';
import {
  MONOREPO_ROOT,
  isMonorepoPresent,
} from '../../scripts/verification/facts';
import { computeHostedIndex } from '../../scripts/verification/hosted-index';
import {
  isOnPortfolio,
  loadHostedIndex,
  parseHostedIndex,
} from '../lib/hosted-index';

const present = isMonorepoPresent();

describe('hosted-index.json', () => {
  test('is structurally valid and every host is in the zone', () => {
    const index = loadHostedIndex();
    for (const host of index.hosts) {
      expect(host.hostname.endsWith(`.${index.zone}`)).toBe(true);
    }
  });

  test('rejects a malformed file', () => {
    expect(() => parseHostedIndex({ version: 1 })).toThrow(/malformed/);
    expect(() =>
      parseHostedIndex({
        version: 1,
        zone: 'example.dev',
        hosts: [{ hostname: 'a.example.dev', id: 'a', via: 'ftp' }],
        domains: [],
      })
    ).toThrow(/malformed/);
  });

  test('knows which hosts the portfolio already links to', () => {
    expect(isOnPortfolio('mockingbird.chrisvouga.dev')).toBe(true);
    expect(isOnPortfolio('vault.chrisvouga.dev')).toBe(false);
  });

  test.skipIf(!present)(
    'matches the inventory (run `bun run hosted-index` after changing it)',
    () => {
      expect(computeHostedIndex(MONOREPO_ROOT)).toEqual(loadHostedIndex());
    }
  );
});
