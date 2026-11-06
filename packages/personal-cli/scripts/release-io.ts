import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../../fleet/src/runner';
import type { Runner } from '../../fleet/src/types';
import { ReleaseError } from './release-error';
import { npmFailureHint } from './release-diagnostics';

type ReleaseStage =
  | 'npm-version'
  | 'build'
  | 'pack'
  | 'consumer-install'
  | 'consumer-command'
  | 'consumer-binary'
  | 'publish'
  | 'publisher-verification';

export async function mustRun(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  options: { run?: Runner; stage?: ReleaseStage } = {}
): Promise<string> {
  const { run = runCommand, stage } = options;
  if (stage) process.stderr.write(`Release: ${stage}\n`);
  const result = await run(command, { cwd, env, timeoutMs: 300_000 });
  if (!result.ok)
    throw new ReleaseError(
      `Release ${stage ?? 'subprocess'} failed (${result.reason}). Raw output is withheld; check this step's tools, network and permissions. Publishing/auth steps also require the correct npm package scope and 2FA approval.${stage === 'publish' ? npmFailureHint(result.stderr) : ''}`
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
    NPM_CONFIG_BROWSER: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_PROGRESS: 'false',
  };
}
