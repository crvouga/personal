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
  const version = (
    await mustRun(
      await npmCommand(['--version']),
      cwd,
      {},
      {
        stage: 'npm-version',
      }
    )
  ).trim();
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
  operation: (env: NodeJS.ProcessEnv) => Promise<T>,
  authorize = interactiveNpm
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
      !process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] ||
      !process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
    )
      throw new ReleaseError(
        'OIDC publishing requires the authorized GitHub Actions workflow with id-token: write.'
      );
    return withNpmAuth('', operation);
  }
  if (options.npmLogin)
    return withNpmAuth('', async (env) => {
      await authorize(['login', '--auth-type=web'], env);
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
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.stderr.isTTY ||
    process.env['CI']
  )
    throw new ReleaseError(
      'npm account approval needs an interactive terminal (use ssh -t when connecting remotely). Run bun run personal:publish:bootstrap --apply --yes --npm-login there; Vault recovery codes are not publishing credentials.'
    );
  process.stderr.write(
    'npm approval: open the URL printed below in your local browser (for example, on your MacBook Air).\nKeep this remote terminal running while you approve; it resumes automatically. Do not press Ctrl+C unless you want to cancel.\n'
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
