import { expect, test } from 'bun:test';
import { propagatedDocument } from '../scripts/release-propagation';
import type { RegistryDocument } from '../scripts/release-model';

const saved: RegistryDocument = {
  'dist-tags': { latest: '0.1.1' },
  versions: { '0.1.1': { version: '0.1.1' } },
};
test('publication verification tolerates delayed version, delayed latest and temporary registry errors', async () => {
  let reads = 0;
  const delays: number[] = [];
  const result = await propagatedDocument(
    '0.1.1',
    async () => {
      reads += 1;
      if (reads === 1) return null;
      if (reads === 2) throw new Error('temporary registry failure');
      if (reads === 3) return { ...saved, 'dist-tags': { latest: '0.1.0' } };
      return saved;
    },
    async (milliseconds) => {
      delays.push(milliseconds);
    }
  );
  expect(result).toEqual(saved);
  expect(reads).toBe(4);
  expect(delays).toEqual([2000, 4000, 6000]);
});

test('registry propagation waits have a fixed deadline and preserve unconfirmed outcomes', async () => {
  let reads = 0;
  let elapsed = 0;
  const result = await propagatedDocument(
    '0.1.1',
    async () => {
      reads += 1;
      return null;
    },
    async (milliseconds) => {
      elapsed += milliseconds;
    }
  );
  expect(result).toBeNull();
  expect(reads).toBe(34);
  expect(elapsed).toBe(310_000);
  await expect(
    propagatedDocument(
      '0.1.1',
      async () => {
        throw new Error('unavailable');
      },
      async () => {}
    )
  ).rejects.toThrow('unavailable');
});

test('verification keeps reading until exact published metadata is confirmed', async () => {
  let reads = 0;
  const result = await propagatedDocument(
    '0.1.1',
    async () => {
      reads += 1;
      return reads < 3
        ? saved
        : {
            ...saved,
            versions: {
              '0.1.1': { version: '0.1.1', dist: { integrity: 'expected' } },
            },
          };
    },
    async () => {},
    (document) => document.versions['0.1.1']?.dist?.integrity === 'expected'
  );
  expect(reads).toBe(3);
  expect(result?.versions['0.1.1']?.dist?.integrity).toBe('expected');
});
