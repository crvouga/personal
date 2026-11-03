import { dirname } from 'node:path';
import { publishingToken } from './release-auth';
import { ReleaseError } from './release-error';
import { mustRun, withNpmAuth } from './release-io';
import { npmCommand } from './npm';

export interface PublisherOptions {
  login: boolean;
  npmLogin: boolean;
  oidc: boolean;
}

export async function checkBootstrapNpm(cwd: string): Promise<void> {
  const version = (await mustRun(await npmCommand(['--version']), cwd)).trim();
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    major < 11 ||
    (major === 11 && minor < 15)
  )
    throw new ReleaseError(
      'Bootstrap requires npm 11.15 or newer for automated trusted-publisher setup. Use the shared mise Node/npm toolchain before publishing.'
    );
}

export async function withPublisher<T>(
  options: PublisherOptions,
  operation: (env: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  if (
    [options.oidc, options.login, options.npmLogin].filter(Boolean).length > 1
  )
    throw new ReleaseError(
      'Choose one authentication method: CI OIDC, Vault login, or npm login.'
    );
  if (options.oidc) {
    if (
      process.env['GITHUB_ACTIONS'] !== 'true' ||
      !process.env['ACTIONS_ID_TOKEN_REQUEST_URL']
    )
      throw new ReleaseError(
        'OIDC publishing requires the authorized GitHub Actions workflow with id-token: write.'
      );
    return withNpmAuth('', operation);
  }
  if (options.npmLogin)
    return withNpmAuth('', async (env) => {
      await interactiveNpm(['login', '--auth-type=web'], env);
      return operation(env);
    });
  return withNpmAuth(
    await publishingToken(process.env, options.login),
    operation
  );
}

export async function interactiveNpm(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY || process.env['CI'])
    throw new ReleaseError(
      'Initial npm account authorization needs a terminal. Run bun run personal:publish:bootstrap --apply --yes --npm-login; Vault recovery codes are not publishing credentials.'
    );
  const child = Bun.spawn(await npmCommand(args), {
    cwd: dirname(env['NPM_CONFIG_USERCONFIG']!),
    env: { ...process.env, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0)
    throw new ReleaseError(
      'npm account authorization or approval did not complete. No credentials were saved outside the temporary session.'
    );
}
