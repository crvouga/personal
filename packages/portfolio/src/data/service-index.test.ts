/**
 * Keeps `/index/` from rotting. The snapshot must match the OpenTofu inventory
 * (skipped inside the Docker build, which has no inventory), and the catalog
 * must describe exactly the hosts in the snapshot: a new host without an entry
 * fails, and an entry for a host that is gone fails.
 */

import { describe, expect, test } from 'bun:test';
import {
  MONOREPO_ROOT,
  isMonorepoPresent,
} from '../../scripts/verification/facts';
import { computeServiceIndex } from '../../scripts/verification/service-index';
import { CATALOG } from '../content/service-index';
import { loadServiceIndex, parseServiceIndex } from '../lib/service-index';

const present = isMonorepoPresent();

describe('service-index.json', () => {
  test('is structurally valid, with unique https hosts', () => {
    const index = loadServiceIndex();
    const names = index.hosts.map((host) => host.hostname);
    expect(new Set(names).size).toBe(names.length);
    for (const host of index.hosts) {
      expect(host.url.startsWith('https://')).toBe(true);
    }
  });

  test('rejects a malformed file', () => {
    expect(() => parseServiceIndex({ version: 1 })).toThrow(/malformed/);
    expect(() =>
      parseServiceIndex({
        version: 1,
        zone: 'example.dev',
        hosts: [
          {
            hostname: 'a.example.dev',
            url: 'https://a.example.dev/',
            id: 'a',
            hosting: 'ftp',
            sourceUrl: null,
          },
        ],
      })
    ).toThrow(/malformed/);
  });

  test('every host has a catalog entry (add one in src/content/service-index.ts)', () => {
    const missing = loadServiceIndex()
      .hosts.map((host) => host.hostname)
      .filter((hostname) => CATALOG[hostname] === undefined);
    expect(missing).toEqual([]);
  });

  test('every catalog entry is for a host that still exists', () => {
    const hosts = new Set(
      loadServiceIndex().hosts.map((host) => host.hostname)
    );
    expect(
      Object.keys(CATALOG).filter((hostname) => !hosts.has(hostname))
    ).toEqual([]);
  });

  test.skipIf(!present)(
    'matches the inventory (run `bun run service-index` after changing it)',
    () => {
      expect(computeServiceIndex(MONOREPO_ROOT)).toEqual(loadServiceIndex());
    }
  );
});
