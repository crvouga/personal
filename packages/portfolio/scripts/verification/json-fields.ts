/**
 * Strict field readers for GitHub API payloads. The refresh never guesses: a
 * missing or mistyped field is an `invalid-response` error naming the
 * endpoint, not a zero in the published snapshot.
 */

import { GitHubInsightsError } from '../../src/lib/github-error';

export const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const invalid = (where: string, key: string, expected: string): never => {
  throw new GitHubInsightsError(
    'invalid-response',
    `${where}: expected \`${key}\` to be ${expected}`
  );
};

export const recordAt = (
  value: unknown,
  key: string,
  where: string
): Record<string, unknown> =>
  toRecord(toRecord(value)?.[key]) ?? invalid(where, key, 'an object');

export const arrayAt = (
  value: unknown,
  key: string,
  where: string
): readonly unknown[] => {
  const field = toRecord(value)?.[key];
  return Array.isArray(field) ? field : invalid(where, key, 'an array');
};

export const stringAt = (
  value: unknown,
  key: string,
  where: string
): string => {
  const field = toRecord(value)?.[key];
  return typeof field === 'string' ? field : invalid(where, key, 'a string');
};

export const nullableStringAt = (
  value: unknown,
  key: string,
  where: string
): string | null => {
  const field = toRecord(value)?.[key];
  if (field === null || field === undefined) return null;
  return typeof field === 'string' ? field : invalid(where, key, 'a string');
};

export const numberAt = (
  value: unknown,
  key: string,
  where: string
): number => {
  const field = toRecord(value)?.[key];
  return typeof field === 'number' && Number.isFinite(field)
    ? field
    : invalid(where, key, 'a number');
};

export const booleanAt = (
  value: unknown,
  key: string,
  where: string
): boolean => {
  const field = toRecord(value)?.[key];
  return typeof field === 'boolean' ? field : invalid(where, key, 'a boolean');
};
