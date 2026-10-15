import type { HealthContext } from '../health/context.js';
import { loadServicesConfig } from '../services.js';
import { automate, type AutomationReport } from './automation.js';
import { campaign, type CampaignReport } from './campaign.js';
import { inventoryPath } from './execution.js';
import { handoff } from './handoff.js';
import { migrationProgress } from './progress.js';

export type MigrationOptions = { readonly audit: boolean; readonly once: boolean; readonly intervalSeconds: number; readonly deadlineSeconds?: number };
export type MigrationUpdate = { readonly report: CampaignReport; readonly reportPath: string; readonly nextActionsPath: string; readonly automation: AutomationReport };
export type MigrationPorts = {
  readonly campaign: typeof campaign;
  readonly automate: typeof automate;
  readonly handoff: typeof handoff;
  readonly reload: (ctx: HealthContext) => HealthContext;
  readonly sleep: (ms: number) => Promise<unknown>;
};
const PORTS: MigrationPorts = {
  campaign, automate, handoff,
  reload: (ctx) => ({ ...ctx, config: loadServicesConfig(inventoryPath(ctx)) }),
  sleep: (ms) => Bun.sleep(ms),
};

/** Advance all available stages; wait only for verified timers/workflows. */
export async function migrate(ctx: HealthContext, options: MigrationOptions, update: (value: MigrationUpdate) => void, signal?: AbortSignal, ports = PORTS): Promise<MigrationUpdate> {
  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 60 || options.intervalSeconds > 3600) throw new Error('Polling interval must be 60..3600 seconds');
  if (options.deadlineSeconds !== undefined && (!Number.isInteger(options.deadlineSeconds) || options.deadlineSeconds < 60)) throw new Error('Deadline must be at least 60 seconds');
  const started = ctx.now().getTime();
  let current = ctx;
  while (true) {
    migrationProgress('prepare', `Checking DNS, registration and services for ${Object.keys(current.config.domains ?? {}).length} domains (read-only)`);
    const prepared = await ports.campaign(current);
    migrationProgress('automation', options.audit ? 'Audit mode: skipping infrastructure execution' : 'Checking available OpenTofu migration stages');
    const automation: AutomationReport = options.audit || prepared.report.status === 'complete' || prepared.report.blockers.some((blocker) => ['TOOL_REQUIRED', 'CLOUDFLARE_READ_ACCESS_REQUIRED'].includes(blocker.code))
      ? { actions: [], progress: [] } : await ports.automate(current, signal);
    current = ports.reload(current);
    // Re-probe after every per-domain execution pass, including a failed apply
    // that changed resources before returning an error and recorded no action.
    const needsVerification = automation.progress.some((row) => row.domain !== '*');
    if (needsVerification) migrationProgress('verify', 'Rechecking domain health and registration after the execution pass (read-only)');
    const final = needsVerification ? await ports.campaign(current) : prepared;
    const report = { ...final.report, status: automation.progress.some((row) => row.state !== 'complete') ? 'blocked' as const : final.report.status };
    migrationProgress('report', 'Writing the migration report and exact remaining actions');
    const value = { report, reportPath: final.path, nextActionsPath: await ports.handoff(current, report, automation), automation };
    update(value);
    if (report.status === 'complete' || options.audit || options.once || signal?.aborted || !automation.progress.some((row) => row.state === 'waiting')) return value;
    if (options.deadlineSeconds !== undefined && current.now().getTime() - started >= options.deadlineSeconds * 1000) return value;
    // Short sleeps make SIGINT/SIGTERM responsive without abandoning an apply.
    migrationProgress('waiting', `Monitoring verified DNS timers or registrar workflows; next check in ${options.intervalSeconds} seconds`);
    for (let elapsed = 0; elapsed < options.intervalSeconds && !signal?.aborted; elapsed++) await ports.sleep(1000);
    if (signal?.aborted) return value;
    current = ports.reload(current);
  }
}
