import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../domain/config.ts';
import { writeConfig, readConfig } from '../adapters/config-file.ts';
import { dependencyInventory } from '../adapters/dependencies.ts';
import { setupSources } from '../application/setup-sources.ts';
import { setupDependencies } from '../application/setup-dependencies.ts';
import { doctor } from '../application/doctor.ts';
import { requireAction } from '../application/actions.ts';
import { action, emit, location, type AppContext } from './context.ts';
import { repoRoot } from '../adapters/paths.ts';
export function registerSetup(program: Command): void {
  const setup = program
    .command('setup')
    .description('Install declared browser and initialize resumable onboarding')
    .option(
      '--system-deps',
      'Install Playwright Linux system libraries through the OS package manager'
    )
    .option(
      '--skip-browser',
      'Initialize offline onboarding without browser installation'
    );
  setup.action(
    action(program, async (app) => {
      if (!existsSync(join(app.directory, 'config.json')))
        writeConfig(
          app.directory,
          parseConfig({
            version: 1,
            sources: [
              {
                id: 'infrastructure',
                kind: 'inventory',
                path: join(
                  repoRoot,
                  'packages/infra/tofu/modules/inventory/inventory.tf.json'
                ),
              },
            ],
          })
        );
      await setupDependencies({
        state: app.state,
        skipBrowser: Boolean(
          setup.opts<{ skipBrowser?: boolean }>().skipBrowser
        ),
        systemDependencies: Boolean(
          setup.opts<{ systemDeps?: boolean }>().systemDeps
        ),
      });
      const config = readConfig(app.directory);
      onboardingAction({ ...app, config });
      setupSources({ ...app, config });
      return {
        status: 'requires-user-action',
        directory: app.directory,
        dependencies: dependencyInventory(),
        diagnostics: await doctor({ ...app, config }),
        next: 'bun run password-manager actions list',
      };
    })
  );
  registerDoctor(program);
}
function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Read-only diagnostics; never initializes private state')
    .action(async () => {
      const directory = location(program);
      const { OsSecrets } = await import('../adapters/keychain.ts');
      const config = readConfig(directory);
      const secrets = new OsSecrets(config.secretService);
      const { BitwardenVault } = await import('../adapters/bitwarden.ts');
      const vault = config.bitwarden
        ? new BitwardenVault({
            directory: join(directory, 'bitwarden'),
            expected: config.bitwarden,
            secrets,
          })
        : null;
      const diagnostics = await doctor({ directory, config, secrets, vault });
      emit(diagnostics);
      process.exitCode = diagnostics.some((d) => d.status !== 'ok') ? 2 : 0;
    });
  program.command('dependencies').action(() => emit(dependencyInventory()));
}
function onboardingAction(app: AppContext): void {
  if (app.config.bitwarden) return;
  requireAction(app.state, {
    accountId: null,
    sourceId: 'bitwarden',
    operationId: null,
    runId: null,
    step: 'bitwarden-registration',
    reason: 'expected-vault-identity-required',
    destination: 'https://vault.bitwarden.com',
    instructions: [
      '1. Choose your existing Bitwarden server and exact account email.',
      '2. In the Bitwarden web vault, open Settings > Security > Keys > API key and authenticate to view your personal client ID and client secret.',
      '3. Run bun run password-manager secrets set bitwarden/client-id, then secrets set bitwarden/client-secret. Enter each value at the masked prompt.',
      '4. Run bun run password-manager connect bitwarden --email YOUR_EMAIL --server https://vault.bitwarden.com (EU: https://vault.bitwarden.eu).',
      '5. Run bun run password-manager run. Unlock is separate and uses a masked master-password prompt; API login does not unlock the vault.',
    ],
    prerequisites: ['An existing account; keep all existing MFA enabled.'],
    expiresAt: null,
    detection:
      'bw status must match the configured server and account; decrypted commands require a separate unlock.',
    resume: 'bun run password-manager connect bitwarden --email YOUR_EMAIL',
    alternative:
      'FIDO2/Duo users use the personal API-key login above; do not disable MFA.',
  });
}
