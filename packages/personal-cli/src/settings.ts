import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface Settings {
  workspace: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findUp(start: string, name: string): Promise<string | null> {
  let current = resolve(start);
  while (true) {
    if (await exists(join(current, name))) return join(current, name);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The checkout: --workspace, PERSONAL_WORKSPACE, closest mise.toml, then cwd. */
export async function resolveSettings(
  overrides: Partial<Settings> = {},
  cwd = process.cwd(),
  env = process.env
): Promise<Settings> {
  const workspace = resolve(
    overrides.workspace ??
      env['PERSONAL_WORKSPACE'] ??
      dirname((await findUp(cwd, 'mise.toml')) ?? join(cwd, 'mise.toml'))
  );
  return { workspace };
}
