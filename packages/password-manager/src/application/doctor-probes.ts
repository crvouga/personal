import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { OsSecrets } from '../adapters/keychain.ts';
import { ManagerError } from '../domain/errors.ts';
import { checkPrivateDirectory } from '../adapters/paths.ts';
import { checkInstalledDependencies } from '../adapters/dependency-check.ts';
import {
  checkPlatform,
  currentPlatform,
  checkCredentialPackages,
  checkSystemExecutables,
} from '../adapters/system-dependencies.ts';
import { command } from '../adapters/process.ts';
import { playwrightCli } from '../adapters/dependencies.ts';
export interface DoctorProbes {
  nodeVersion: string;
  dependencies(): void;
  platform(): Promise<void>;
  systemPackages(): Promise<void>;
  executables(): void;
  privateDirectory(path: string): void;
  exists(path: string): boolean;
  browserAvailable(): boolean;
  browserNative(): Promise<void>;
  nativeSecrets(): Promise<void>;
  now(): number;
  fetch: typeof fetch;
}
export const doctorProbes: DoctorProbes = {
  nodeVersion: process.versions.node,
  dependencies: checkInstalledDependencies,
  platform: () => checkPlatform(currentPlatform()),
  systemPackages: checkCredentialPackages,
  executables: checkSystemExecutables,
  privateDirectory: checkPrivateDirectory,
  exists: existsSync,
  browserAvailable: () => existsSync(chromium.executablePath()),
  browserNative,
  nativeSecrets: () => new OsSecrets().checkDriver(),
  now: Date.now,
  fetch,
};
async function browserNative(): Promise<void> {
  if (process.platform === 'linux') {
    try {
      await command({
        executable: process.execPath,
        args: [playwrightCli(), 'install-deps', '--dry-run', 'chromium'],
      });
    } catch {
      throw new ManagerError('missing');
    }
  }
  const browser = await chromium.launch({ headless: true });
  await browser.close();
}
