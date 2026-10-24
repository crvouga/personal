import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import type { StateStore } from '../domain/ports.ts';
import { safeCode } from '../domain/errors.ts';
import {
  checkPlatform,
  currentPlatform,
  checkCredentialPackages,
} from '../adapters/system-dependencies.ts';
import { checkInstalledDependencies } from '../adapters/dependency-check.ts';
import { installBrowser } from '../adapters/dependencies.ts';
import { doctorProbes } from './doctor-probes.ts';
import { requireAction } from './actions.ts';
export async function setupDependencies(input: {
  state: StateStore;
  systemDependencies: boolean;
  skipBrowser: boolean;
}): Promise<string> {
  try {
    await checkPlatform(currentPlatform());
    checkInstalledDependencies();
    let system = input.systemDependencies;
    try {
      await checkCredentialPackages();
      if (!input.skipBrowser) await doctorProbes.browserNative();
    } catch {
      system = true;
    }
    if (
      !input.skipBrowser &&
      (system || !existsSync(chromium.executablePath()))
    )
      await installBrowser(system);
    resolveSetupAction(input.state);
    return 'completed';
  } catch (error) {
    const reason = safeCode(error);
    requireAction(input.state, {
      accountId: null,
      sourceId: 'dependencies',
      operationId: null,
      runId: null,
      step: 'system-dependencies',
      reason,
      destination: null,
      instructions: [
        '1. Inspect bun run password-manager doctor to identify the exact missing/wrong dependency.',
        '2. On supported Debian/Ubuntu, run sudo -v in your terminal to authenticate for the declared apt/Playwright system packages. The tool itself uses sudo -n and cannot hang on a privilege prompt.',
        '3. Run bun run password-manager setup --system-deps. Packages come from system-dependencies.json and the locked Playwright registry; no tools are upgraded implicitly.',
        '4. Use an existing desktop user D-Bus session and unlock its persistent Secret Service (macOS: unlock login Keychain). Return to the terminal and rerun doctor.',
        '5. For missing/wrong npm tools, run bun install --force --frozen-lockfile at the root, then repeat the resume command.',
      ],
      prerequisites: [
        'A supported platform and administrator authorization for OS package installation.',
      ],
      expiresAt: null,
      detection:
        'Read-only platform, installed-version, provenance, native-library and secret-store checks pass.',
      resume: 'bun run password-manager setup --system-deps',
      alternative:
        'Use the declared macOS/Linux environment; local archives can be inspected without a vault session.',
    });
    return 'requires-user-action';
  }
}
function resolveSetupAction(state: StateStore): void {
  for (const action of state
    .list('actions')
    .filter((a) => a.sourceId === 'dependencies'))
    state.put('actions', { ...action, status: 'resolved' });
}
