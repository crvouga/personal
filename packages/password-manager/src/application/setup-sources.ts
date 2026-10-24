import { join } from 'node:path';
import type { Config } from '../domain/config.ts';
import type { StateStore } from '../domain/ports.ts';
import {
  detectBrowserSources,
  type BrowserSource,
} from '../adapters/browser-sources.ts';
import { ensurePrivateDirectory } from '../adapters/paths.ts';
import { shellQuote } from '../domain/commands.ts';
import { requireAction } from './actions.ts';
export function setupSources(
  input: { directory: string; config: Config; state: StateStore },
  detected: BrowserSource[] = detectBrowserSources()
): void {
  if (!detected.length) return;
  ensurePrivateDirectory(join(input.directory, 'exports'));
  for (const source of detected) {
    if (input.config.sources.some((s) => s.id === source.id)) continue;
    const path = join(input.directory, 'exports', source.id + '.csv');
    const resume = `bun run password-manager sources add ${source.id} csv --file ${shellQuote(path)}`;
    requireAction(input.state, {
      accountId: null,
      operationId: null,
      runId: null,
      sourceId: source.id,
      step: 'browser-export',
      reason: 'browser-requires-native-export-authentication',
      destination: null,
      instructions: [
        ...source.instructions.slice(0, 2),
        `3. Save the export to ${path}, then run the resume command.`,
        `4. Run bun run password-manager discover --source ${source.id} and inspect its import plan before applying.`,
      ],
      prerequisites: [
        `${source.browser}, selected profile ${source.profile}; complete the OS authentication prompt.`,
      ],
      expiresAt: null,
      detection:
        'The explicitly registered file completes discovery; imports require a separately selected plan and vault readback.',
      resume,
      alternative:
        'Skip this source with actions skip ACTION_ID --reason deferred; other sources can continue.',
    });
  }
}
