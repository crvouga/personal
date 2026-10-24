import { join } from 'node:path';
import type { SecretStore } from '@pkgs/secret-store';
import type { Config } from '../domain/config.ts';
import type { Vault } from '../domain/ports.ts';
import { ManagerError, safeCode } from '../domain/errors.ts';
import { NODE_VERSION } from '../adapters/dependencies.ts';
import { SqliteState } from '../adapters/state.ts';
import { doctorProbes, type DoctorProbes } from './doctor-probes.ts';
import { checkSource } from './doctor-source.ts';
export interface Diagnostic {
  name: string;
  status: string;
  remediation: string | null;
}
export interface DoctorInput {
  config: Config;
  directory: string;
  secrets: SecretStore;
  vault: Vault | null;
  probes?: Partial<DoctorProbes>;
}
export async function doctor(input: DoctorInput): Promise<Diagnostic[]> {
  const probes = { ...doctorProbes, ...input.probes };
  const setup = 'sh scripts/password-manager-setup.sh';
  const result: Diagnostic[] = [
    {
      name: 'node',
      status: probes.nodeVersion === NODE_VERSION ? 'ok' : 'wrong-version',
      remediation:
        'mise install && mise exec -- bun run password-manager doctor',
    },
    await check(
      'platform',
      probes.platform,
      'Use macOS 14+ or a declared Debian/Ubuntu release on arm64/x64.'
    ),
    await check(
      'declared-dependencies',
      async () => {
        probes.dependencies();
      },
      setup
    ),
    await check(
      'OS-packages',
      probes.systemPackages,
      'bun run password-manager setup --system-deps'
    ),
    await check(
      'OS-executables',
      async () => {
        probes.executables();
      },
      'bun run password-manager setup --system-deps'
    ),
    await check(
      'private-state',
      async () => {
        probes.privateDirectory(input.directory);
      },
      'bun run password-manager setup'
    ),
    await check(
      'OS-secret-driver',
      probes.nativeSecrets,
      'bun install --force --frozen-lockfile; use a declared supported platform/architecture.'
    ),
    await check(
      'persistent-secret-store',
      async () => {
        await input.secrets.getOptional('doctor/read-only');
      },
      'Unlock the persistent OS credential store in the current user session; rerun doctor.'
    ),
    await browserDiagnostic(probes),
    await vaultDiagnostic(input, probes),
    await interruptedDiagnostic(input, probes),
  ];
  for (const source of input.config.sources.filter((s) => s.enabled)) {
    result.push(
      await check(
        `source:${source.id}`,
        () => checkSource({ source, secrets: input.secrets, probes }),
        `bun run password-manager discover --source ${source.id}`
      )
    );
  }
  return result;
}
async function vaultDiagnostic(
  input: DoctorInput,
  probes: DoctorProbes
): Promise<Diagnostic> {
  const result = await check(
    'bitwarden',
    async () => {
      if (!input.config.bitwarden) throw new ManagerError('missing');
      if (!probes.exists(join(input.directory, 'bitwarden', 'data.json')))
        throw new ManagerError('not-authenticated');
      const status = await input.vault?.status();
      if (!status) throw new ManagerError('unavailable');
      if (status.status === 'unauthenticated')
        throw new ManagerError('not-authenticated');
      if (
        status.serverUrl !== input.config.bitwarden.server ||
        status.userEmail !== input.config.bitwarden.email
      )
        throw new ManagerError('conflict');
      if (status.status === 'locked') throw new ManagerError('locked');
    },
    'bun run password-manager connect bitwarden'
  );
  if (result.status === 'locked')
    result.remediation =
      'bun run password-manager run (unlock at the masked prompt)';
  return result;
}
async function browserDiagnostic(probes: DoctorProbes): Promise<Diagnostic> {
  if (!probes.browserAvailable())
    return {
      name: 'chromium',
      status: 'missing',
      remediation: 'bun run password-manager setup',
    };
  return check(
    'chromium-native-libraries',
    probes.browserNative,
    'bun run password-manager setup --system-deps'
  );
}
async function interruptedDiagnostic(
  input: DoctorInput,
  probes: DoctorProbes
): Promise<Diagnostic> {
  return check(
    'interrupted-operations',
    async () => {
      if (!probes.exists(join(input.directory, 'workflow.sqlite'))) return;
      const state = new SqliteState(input.directory, true);
      try {
        if (
          state
            .list('operations')
            .some(
              (op) =>
                op.state !== 'completed' && (op.submittedAt || op.stagedRef)
            )
        )
          throw new ManagerError('requires-user-action');
      } finally {
        state.close();
      }
    },
    'bun run password-manager status; inspect pending operations, then recover OPERATION_ID individually.'
  );
}
async function check(
  name: string,
  work: () => Promise<void>,
  remediation: string
): Promise<Diagnostic> {
  try {
    await work();
    return { name, status: 'ok', remediation: null };
  } catch (error) {
    const missing =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT';
    return { name, status: missing ? 'missing' : safeCode(error), remediation };
  }
}
