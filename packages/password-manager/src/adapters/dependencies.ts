import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { bitwardenExecutable, BW_VERSION } from './bitwarden.ts';
import {
  acquireSystemDependencies,
  systemManifest,
} from './system-dependencies.ts';
import { command } from './process.ts';
const require = createRequire(import.meta.url);
export const NODE_VERSION = '22.22.3';
export const BUN_VERSION = '1.4.4';
export const PLAYWRIGHT_VERSION = '1.63.0';
export function dependencyInventory() {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  ) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  return {
    node: {
      version: NODE_VERSION,
      owner: 'root mise.toml',
      diagnostic: 'process.versions.node',
    },
    bun: {
      version: BUN_VERSION,
      owner: 'root mise.toml',
      diagnostic: 'mise exec -- bun --version',
    },
    bw: {
      version: BW_VERSION,
      owner: 'bun.lock',
      executable: bitwardenExecutable(),
    },
    chromium: {
      version: PLAYWRIGHT_VERSION,
      owner: 'locked Playwright browser registry',
      executable: chromium.executablePath(),
    },
    npm: { ...manifest.dependencies, ...manifest.devDependencies },
    os:
      process.platform === 'darwin'
        ? ['macOS Keychain; OS-managed, macOS 14+']
        : [
            'Debian 12/Ubuntu 22.04+; Playwright install-deps chromium',
            'D-Bus session + persistent Secret Service (gnome-keyring or KWallet); OS-managed',
          ],
    nativeBuild:
      'Prebuilt keyring binaries only; unsupported architectures fail, no implicit Rust/compiler installation.',
    extensions: 'None',
    system: systemManifest,
  };
}
export function playwrightCli(): string {
  return join(dirname(require.resolve('playwright/package.json')), 'cli.js');
}
export async function installBrowser(
  systemDependencies: boolean
): Promise<void> {
  if (systemDependencies)
    await acquireSystemDependencies({ playwrightCli: playwrightCli() });
  await command({
    executable: process.execPath,
    args: [playwrightCli(), 'install', 'chromium'],
    timeoutMs: 300_000,
    maxBytes: 1024 * 1024,
  });
}
