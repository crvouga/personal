import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../../fleet/src/runner';
import type { Runner } from '../../fleet/src/types';
import { ReleaseError } from './release-error';

export async function mustRun(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  run: Runner = runCommand
): Promise<string> {
  const result = await run(command, { cwd, env, timeoutMs: 300_000 });
  if (!result.ok)
    throw new ReleaseError(
      `Release subprocess failed (${result.reason}). Raw output is withheld; inspect Node/npm, network, permissions and the npm publishing token's package scope/2FA policy.`
    );
  return result.stdout;
}

export async function withNpmAuth<T>(
  token: string,
  operation: (env: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-npm-auth-'));
  const config = join(directory, 'npmrc');
  try {
    await writeFile(
      config,
      'registry=https://registry.npmjs.org/\n' +
        (token ? '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' : ''),
      { mode: 0o600 }
    );
    return await operation(npmEnvironment(directory, token));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function npmEnvironment(
  directory: string,
  token = '',
  inherited = process.env
): NodeJS.ProcessEnv {
  const cleared = Object.fromEntries(
    Object.keys(inherited)
      .filter((name) =>
        /^(npm_config_|node_auth_token$|npm_token$|npm_id_token$)/i.test(name)
      )
      .map((name) => [name, undefined])
  );
  return {
    ...cleared,
    NODE_AUTH_TOKEN: token,
    NPM_TOKEN: '',
    NPM_CONFIG_USERCONFIG: join(directory, 'npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(directory, 'global-npmrc'),
    NPM_CONFIG_CACHE: join(directory, 'cache'),
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    NPM_CONFIG_LOGLEVEL: 'error',
  };
}
