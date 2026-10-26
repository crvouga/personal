/**
 * Mockingbird's own published totals. The docs site renders its headline
 * numbers from `catalog.json`; reading the same file means the portfolio and
 * Mockingbird's site can never disagree about how many emulators exist.
 */
import type { CatalogStats } from '../../src/lib/verification';

export const MOCKINGBIRD_CATALOG_URL =
  'https://mockingbird.chrisvouga.dev/catalog.json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const countAt = (totals: Record<string, unknown>, key: string): number => {
  const value = totals[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${MOCKINGBIRD_CATALOG_URL}: totals.${key} is not a count`);
  }
  return value;
};

export const fetchMockingbirdCatalog = async (
  fetchFn: typeof fetch = fetch
): Promise<CatalogStats> => {
  const response = await fetchFn(MOCKINGBIRD_CATALOG_URL);
  if (!response.ok) {
    throw new Error(
      `${MOCKINGBIRD_CATALOG_URL} returned HTTP ${String(response.status)}`
    );
  }
  const json: unknown = await response.json();
  const totals = isRecord(json) ? json['totals'] : undefined;
  if (!isRecord(totals)) {
    throw new Error(`${MOCKINGBIRD_CATALOG_URL} has no totals`);
  }
  return {
    url: MOCKINGBIRD_CATALOG_URL,
    services: countAt(totals, 'services'),
    opsSupported: countAt(totals, 'opsSupported'),
    opsTotal: countAt(totals, 'opsTotal'),
  };
};
