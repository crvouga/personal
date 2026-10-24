import { readFileSync, existsSync } from 'node:fs';
import { command, baseEnvironment, type Command } from './process.ts';
import { ManagerError } from '../domain/errors.ts';
export interface SystemManifest {
  version: number;
  bootstrapPackages: string[];
  architectures: string[];
  darwin: {
    minimumMajor: number;
    secretStore: string;
    scheduler: string;
    opener: string;
  };
  linux: {
    distributions: Record<string, string[]>;
    credentialPackages: string[];
    owner: string;
    packageManager: string;
    query: string;
    privilege: string;
    scheduler: string;
    opener: string;
    sessionRequirement: string;
  };
  browserLibraries: { owner: string; diagnostic: string; acquisition: string };
}
export const systemManifest = JSON.parse(
  readFileSync(
    new URL('../../system-dependencies.json', import.meta.url),
    'utf8'
  )
) as SystemManifest;
export type Execute = (input: Command) => Promise<string>;
export async function checkPlatform(input: {
  platform: string;
  arch: string;
  execute: Execute;
  osRelease: string;
}): Promise<void> {
  if (!systemManifest.architectures.includes(input.arch))
    throw new ManagerError('unsupported-platform');
  if (input.platform === 'darwin') {
    const version = await input.execute({
      executable: '/usr/bin/sw_vers',
      args: ['-productVersion'],
    });
    if (Number(version.split('.')[0]) < systemManifest.darwin.minimumMajor)
      throw new ManagerError('unsupported-platform');
    return;
  }
  if (input.platform !== 'linux')
    throw new ManagerError('unsupported-platform');
  const fields = Object.fromEntries(
    input.osRelease
      .split('\n')
      .map((line) => line.split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key, value?.replace(/^"|"$/g, '')])
  );
  if (
    !systemManifest.linux.distributions[String(fields['ID'])]?.includes(
      String(fields['VERSION_ID'])
    )
  )
    throw new ManagerError('unsupported-platform');
}
export function currentPlatform(execute: Execute = command) {
  return {
    platform: process.platform,
    arch: process.arch,
    execute,
    osRelease:
      process.platform === 'linux'
        ? readFileSync('/etc/os-release', 'utf8')
        : '',
  };
}
export async function checkCredentialPackages(
  execute: Execute = command
): Promise<void> {
  if (process.platform !== 'linux') return;
  try {
    const status = await execute({
      executable: systemManifest.linux.query,
      args: [
        '-W',
        '-f=${db:Status-Abbrev}\n',
        ...systemManifest.linux.credentialPackages,
      ],
    });
    if (
      status
        .split('\n')
        .filter(Boolean)
        .some((line) => !line.startsWith('ii'))
    )
      throw new ManagerError('missing');
  } catch {
    throw new ManagerError('missing');
  }
}
export async function acquireSystemDependencies(input: {
  playwrightCli: string;
  execute?: Execute;
  platform?: string;
  root?: boolean;
}): Promise<void> {
  const execute = input.execute ?? command;
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') return;
  const root = input.root ?? process.getuid?.() === 0;
  if (!root) await requirePrivilege(execute);
  await privileged({
    execute,
    root,
    executable: systemManifest.linux.packageManager,
    args: ['update'],
  });
  await privileged({
    execute,
    root,
    executable: systemManifest.linux.packageManager,
    args: ['install', '-y', ...systemManifest.linux.credentialPackages],
  });
  await privileged({
    execute,
    root,
    executable: process.execPath,
    args: [input.playwrightCli, 'install-deps', 'chromium'],
  });
}
async function requirePrivilege(execute: Execute): Promise<void> {
  try {
    await execute({
      executable: systemManifest.linux.privilege,
      args: ['-n', 'true'],
      timeoutMs: 5000,
    });
  } catch {
    throw new ManagerError('requires-user-action');
  }
}
async function privileged(input: {
  execute: Execute;
  root: boolean;
  executable: string;
  args: string[];
}): Promise<void> {
  await input.execute({
    executable: input.root ? input.executable : systemManifest.linux.privilege,
    args: input.root ? input.args : ['-n', input.executable, ...input.args],
    timeoutMs: 300_000,
    env: { ...baseEnvironment(), DEBIAN_FRONTEND: 'noninteractive' },
  });
}
export function checkSystemExecutables(): void {
  const paths =
    process.platform === 'darwin'
      ? systemManifest.darwin
      : systemManifest.linux;
  if (![paths.scheduler, paths.opener].every((path) => existsSync(path)))
    throw new ManagerError('missing');
}
