import source from '../definition.json';
import { spawn } from 'node:child_process';
import { parseDefinition } from './definition';
import { pinnedPath } from './agents/toolchain';
import type { Runner } from './types';
import {
  secretsProvider,
  type SecretCommand,
  type SecretsProvider,
} from './secrets';

/** This fleet's own configuration: its machines, endpoints, accounts and source
 * repository. Fleet code never names any of them; it reads them here, and this
 * is the only module that loads the file.
 */
export const fleet = parseDefinition(source);

/** Reads one of this fleet's secrets for this node. Tools run from the pinned
 * toolchain, whatever PATH the caller (T3, launchd, systemd) started with.
 */
export const secret: SecretsProvider = (name) =>
  secretsProvider(fleet.secrets, { run: pinned })(name);

/** The same, through an injected runner (fleet-sync phases and their tests). */
export const secretVia = (run: Runner): SecretsProvider =>
  secretsProvider(fleet.secrets, {
    run: async (argv) => {
      const result = await run(argv, { timeoutMs: 20_000 });
      return result.ok ? result.stdout : null;
    },
  });

const pinned: SecretCommand = (argv) =>
  new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
      env: { ...process.env, PATH: pinnedPath() },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 65_536) output += chunk.toString('utf8');
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output : null));
  });
