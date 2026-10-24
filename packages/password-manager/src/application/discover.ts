import type { Config, SourceConfig } from '../domain/config.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import type { Coverage } from '../domain/model.ts';
import { ManagerError, safeCode } from '../domain/errors.ts';
import {
  scanVault,
  type DiscoveryContext,
  type Scan,
} from '../adapters/discovery.ts';
import {
  scanCsv,
  scanBitwardenJson,
  scanInventory,
} from '../adapters/exports.ts';
import { scanConfirmed } from '../adapters/confirmed.ts';
import { scanArchive } from '../adapters/archives.ts';
import { scanGmail } from '../adapters/gmail.ts';
import { scanMicrosoft } from '../adapters/microsoft.ts';
import { validateSourceIdentity } from '../adapters/source-identity.ts';
import { refreshOAuth } from '../adapters/oauth.ts';
import { scanImap } from '../adapters/imap.ts';
import { sourceNeedsAttention } from './source-actions.ts';
import { unsupportedSourceItem } from './source-actions.ts';
import { reconcile } from './reconcile.ts';
const scanners: Record<
  SourceConfig['kind'],
  (
    source: SourceConfig,
    context: DiscoveryContext,
    cursor: string | null
  ) => Scan
> = {
  bitwarden: scanVault,
  csv: scanCsv,
  'bitwarden-json': scanBitwardenJson,
  mbox: scanArchive,
  eml: scanArchive,
  gmail: scanGmail,
  microsoft: scanMicrosoft,
  imap: scanImap,
  inventory: scanInventory,
  confirmed: scanConfirmed,
};
export function sourceScan(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null
): Scan {
  return scanners[source.kind](source, context, cursor);
}
export async function discover(input: {
  config: Config;
  state: StateStore;
  context: DiscoveryContext;
  sourceId?: string;
  cancelled?: () => boolean;
}): Promise<Coverage[]> {
  if (
    input.sourceId &&
    !input.config.sources.some((s) => s.id === input.sourceId)
  )
    throw new ManagerError('missing');
  const coverage: Coverage[] = [];
  for (const source of input.config.sources) {
    if (input.sourceId && source.id !== input.sourceId) continue;
    if (input.cancelled?.()) break;
    coverage.push(await scanLocked(source, input));
  }
  reconcile(input.state, input.config.priorityOrigins);
  return coverage;
}
async function scanOne(
  source: SourceConfig,
  input: {
    state: StateStore;
    context: DiscoveryContext;
    cancelled?: () => boolean;
  }
): Promise<void> {
  const previous = input.state.get('coverage', source.id);
  const coverage = initialCoverage(source, previous);
  if (previous && previous.filters !== coverage.filters) coverage.cursor = null;
  if (!source.enabled) {
    input.state.put('coverage', { ...coverage, state: 'skipped' });
    return;
  }
  try {
    if (['gmail', 'microsoft'].includes(source.kind))
      await refreshOAuth({
        source,
        secrets: input.context.secrets,
        fetch: input.context.fetch,
      });
    if (['gmail', 'microsoft'].includes(source.kind)) {
      const token = JSON.parse(
        (
          await input.context.secrets.getRequired(source.tokenRef!)
        ).readSecretValue()
      ) as { accessToken: string };
      await validateSourceIdentity({
        source,
        token: token.accessToken,
        fetch: input.context.fetch,
      });
    }
    await consumeScan(source, input, coverage);
  } catch (error) {
    coverage.error = safeCode(error);
    coverage.state = sourceErrorState(coverage.error);
    if (coverage.error === 'stale-cursor') coverage.cursor = null;
    sourceNeedsAttention(input.state, source, coverage.error);
  }
  input.state.put('coverage', coverage);
}
function initialCoverage(
  source: SourceConfig,
  previous: Coverage | null
): Coverage {
  return {
    id: source.id,
    state: 'incomplete',
    scanned: 0,
    discovered: 0,
    lastSuccess: previous?.lastSuccess ?? null,
    cursor: previous?.cursor ?? null,
    filters: JSON.stringify({
      kind: source.kind,
      path: source.path ?? null,
      identity: source.identity ?? null,
      host: source.host ?? null,
      port: source.port,
      includeShared: source.includeShared,
      query: source.query,
      after: source.after,
      before: source.before ?? null,
      includeSpamTrash: source.includeSpamTrash,
      maxMessages: source.maxMessages,
    }),
    error: null,
  };
}
export function expireSource(
  state: StateStore,
  id: string,
  runtime: Runtime
): void {
  const coverage = state.get('coverage', id);
  if (coverage)
    state.put('coverage', {
      ...coverage,
      state: 'requires-user-action',
      error: 'expired-connection',
      filters: coverage.filters,
      cursor: null,
    });
  void runtime;
}

async function consumeScan(
  source: SourceConfig,
  input: {
    state: StateStore;
    context: DiscoveryContext;
    cancelled?: () => boolean;
  },
  coverage: Coverage
): Promise<void> {
  const scan = sourceScan(source, input.context, coverage.cursor);
  for (;;) {
    if (input.cancelled?.()) {
      await scan.return({
        cursor: null,
        complete: false,
        scanned: coverage.scanned,
      });
      return;
    }
    const next = await scan.next();
    if (next.done) {
      coverage.scanned = next.value.scanned;
      coverage.state = next.value.complete ? 'scanned' : 'incomplete';
      coverage.cursor = next.value.cursor;
      if (next.value.complete) {
        coverage.cursor = next.value.cursor;
        coverage.lastSuccess = input.context.runtime.now();
        resolveSourceActions(input.state, source.id);
      }
      return;
    }
    input.state.put('evidence', next.value);
    unsupportedSourceItem(input.state, next.value);
    coverage.discovered++;
  }
}

function resolveSourceActions(state: StateStore, sourceId: string): void {
  for (const action of state
    .list('actions')
    .filter(
      (a) =>
        a.sourceId === sourceId &&
        [
          'oauth-consent',
          'source-scan',
          'browser-export',
          'bitwarden-registration',
        ].includes(a.step)
    )) {
    state.put('actions', { ...action, status: 'resolved' });
  }
}

function sourceErrorState(code: string): Coverage['state'] {
  if (
    [
      'expired-connection',
      'insufficient-scope',
      'not-authenticated',
      'locked',
      'requires-user-action',
    ].includes(code)
  )
    return 'requires-user-action';
  return code === 'stale-cursor' ? 'incomplete' : 'failed';
}

async function scanLocked(
  source: SourceConfig,
  input: Parameters<typeof discover>[0]
): Promise<Coverage> {
  try {
    await input.state.withLock(`source:${source.id}`, () =>
      scanOne(source, input)
    );
    return input.state.get('coverage', source.id)!;
  } catch (error) {
    if (safeCode(error) !== 'busy') throw error;
    return {
      ...initialCoverage(source, input.state.get('coverage', source.id)),
      state: 'incomplete',
      error: 'busy',
    };
  }
}
