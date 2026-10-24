import { existsSync, readFileSync } from 'node:fs';
import { atomicPrivateWrite } from './private-write.ts';
import { join } from 'node:path';
import type { StateStore } from '../domain/ports.ts';
import { parseConfig, type Config } from '../domain/config.ts';
import { checkPrivateFile, ensurePrivateDirectory } from './paths.ts';
export function readConfig(directory: string): Config {
  const path = join(directory, 'config.json');
  if (!existsSync(path)) return parseConfig({ version: 1 });
  checkPrivateFile(path);
  return parseConfig(JSON.parse(readFileSync(path, 'utf8')));
}
export function writeConfig(directory: string, config: Config): void {
  ensurePrivateDirectory(directory);
  const target = join(directory, 'config.json');
  atomicPrivateWrite(
    target,
    JSON.stringify(parseConfig(config), null, 2) + '\n'
  );
}

export async function updateConfig(
  input: { directory: string; state: StateStore },
  update: (current: Config) => Config
): Promise<Config> {
  return input.state.withLock('configuration', async () => {
    const config = parseConfig(update(readConfig(input.directory)));
    writeConfig(input.directory, config);
    return config;
  });
}
