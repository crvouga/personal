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
    expect(() => parseServiceIndex({ version: 2 })).toThrow(/malformed/);
    expect(() =>
      parseServiceIndex({
        version: 2,
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
        resources: [],
      })
    ).toThrow(/malformed/);
  });

  const keys = (): readonly string[] => {
    const index = loadServiceIndex();
    return [
      ...index.hosts.map((host) => host.hostname),
      ...index.resources.map((resource) => resource.key),
    ];
  };

  test('every host and store has a catalog entry (add one in src/content/service-index.ts)', () => {
    expect(keys().filter((key) => CATALOG[key] === undefined)).toEqual([]);
  });

  test('every catalog entry is for a host or store that still exists', () => {
    const known = new Set(keys());
    expect(Object.keys(CATALOG).filter((key) => !known.has(key))).toEqual([]);
  });

  test('items with several links name each one', () => {
    const titles = new Map<string, number>();
    for (const entry of Object.values(CATALOG)) {
      const key = `${entry.category} ${entry.title}`;
      titles.set(key, (titles.get(key) ?? 0) + 1);
    }
    const unnamed = Object.entries(CATALOG)
      .filter(
        ([, entry]) =>
          entry.variant === null &&
          (titles.get(`${entry.category} ${entry.title}`) ?? 0) > 1
      )
      .map(([key]) => key);
    expect(unnamed).toEqual([]);
  });

  test.skipIf(!present)(
    'matches the inventory (run `bun run service-index` after changing it)',
    () => {
      expect(computeServiceIndex(MONOREPO_ROOT)).toEqual(loadServiceIndex());
    }
  );
});
