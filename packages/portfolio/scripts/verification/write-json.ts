/**
 * Writes a generated JSON file in the repository's Prettier style, so a
 * regenerated file passes the root `prettier --check` (`bun run check`) as is.
 *
 * Prettier is the workspace root's formatter (root devDependency); it is
 * resolved from the root `node_modules` rather than added to this package.
 * Only generator scripts import this module — never the site build.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';

export const formatJson = async (
  value: unknown,
  path: string
): Promise<string> => {
  const options = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(value), { ...options, filepath: path });
};

/** Returns whether the file's contents changed. */
export const writeJson = async (
  value: unknown,
  path: string
): Promise<boolean> => {
  const body = await formatJson(value, path);
  let before = '';
  try {
    before = readFileSync(path, 'utf8');
  } catch {
    before = '';
  }
  writeFileSync(path, body, 'utf8');
  return body !== before;
};
