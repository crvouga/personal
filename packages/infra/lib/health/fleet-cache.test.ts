import { expect, test } from 'bun:test';
import { checkFleetCache } from './check-fleet-cache';
import { fakeContext } from './fixtures.test-support';

test('Fleet cache health distinguishes an unpublished/dead cache from a usable index', async () => {
  for (const [status, body, expected] of [
    [404, 'not deployed', 'fail'], [200, '{}', 'fail'],
    [200, 'StoreDir: /nix/store\nWantMassQuery: 1\n', 'pass'],
  ] as const) {
    const context = fakeContext({ fetch: (async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://turborepo.example.dev/nix/nix-cache-info');
      return new Response(body, { status });
    }) as typeof fetch });
    expect((await checkFleetCache(context))[0]?.status).toBe(expected);
  }
});
