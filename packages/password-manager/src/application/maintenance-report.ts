import { createHash } from 'node:crypto';
import type { Config } from '../domain/config.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import { capabilities } from '../domain/capabilities.ts';
import { requireAction } from './actions.ts';
export function maintenanceReport(input: {
  config: Config;
  state: StateStore;
  runtime: Runtime;
  status: string;
}) {
  const { state, runtime, config } = input;
  const cutoff =
    Date.parse(runtime.now()) - config.backupMaxAgeDays * 86400_000;
  const fresh = state
    .list('backups')
    .some((b) => b.verifiedAt && Date.parse(b.createdAt) >= cutoff);
  maintenanceAction(state, 'backup-freshness', !fresh, {
    instructions: [
      '1. Keep the independent backup password outside the vault and this machine.',
      '2. Run bun run password-manager backup create, then backup verify BACKUP_ID.',
      '3. Copy the encrypted .pwm file to your chosen protected backup destination. Ordinary verification does not restore into your live vault.',
    ],
    resume: 'bun run password-manager backup create',
  });
  staleOperations(state, runtime);
  const capabilityDigest = createHash('sha256')
    .update(JSON.stringify(capabilities))
    .digest('hex');
  const previous = state
    .list('maintenance')
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const pending = state
    .list('actions')
    .filter((a) => a.status === 'pending')
    .map((a) => a.id)
    .sort();
  const notificationDigest = createHash('sha256')
    .update(JSON.stringify(pending))
    .digest('hex');
  const result = {
    id: runtime.id(),
    at: runtime.now(),
    status: input.status,
    pendingActions: pending.length,
    backupFresh: fresh,
    capabilityDigest,
    notificationDigest,
  };
  state.put('maintenance', result);
  for (const record of state.list('maintenance'))
    if (
      Date.parse(record.at) <
      Date.parse(runtime.now()) - config.retentionDays * 86400_000
    )
      state.remove('maintenance', record.id);
  return {
    ...result,
    notificationChanged: previous?.notificationDigest !== notificationDigest,
    capabilitiesChanged: previous
      ? previous.capabilityDigest !== capabilityDigest
      : false,
  };
}
function maintenanceAction(
  state: StateStore,
  step: string,
  needed: boolean,
  input: { instructions: string[]; resume: string }
): void {
  if (!needed) {
    for (const action of state
      .list('actions')
      .filter((a) => a.sourceId === 'maintenance' && a.step === step))
      state.put('actions', { ...action, status: 'resolved' });
    return;
  }
  requireAction(state, {
    accountId: null,
    operationId: null,
    runId: null,
    sourceId: 'maintenance',
    step,
    reason: 'verified-backup-missing-or-stale',
    destination: null,
    instructions: input.instructions,
    prerequisites: ['Unlocked vault and persistent OS credential store.'],
    expiresAt: null,
    detection: 'A recent backup record has passed isolated verification.',
    resume: input.resume,
    alternative:
      'Use an independently password-protected Bitwarden export and retain its limitations; this tool keeps backup readiness unknown until rehearsed.',
  });
}

function staleOperations(state: StateStore, runtime: Runtime): void {
  for (const op of state.list('operations')) {
    if (!op.submittedAt || ['completed', 'cancelled'].includes(op.state))
      continue;
    if (Date.parse(runtime.now()) - Date.parse(op.submittedAt) < 86400_000)
      continue;
    requireAction(state, {
      accountId: op.accountId,
      operationId: op.id,
      runId: op.runId,
      sourceId: null,
      step: 'stale-operation',
      reason: 'submitted-operation-pending-over-one-day',
      destination: state.get('accounts', op.accountId)?.origin ?? null,
      instructions: [
        '1. Inspect this operation and preserve its encrypted old/staged credentials.',
        '2. Resume reconciliation. Do not repeat an ambiguous remote change.',
      ],
      prerequisites: [],
      expiresAt: null,
      detection:
        'Fresh authentication and vault readback establish completion.',
      resume: `bun run password-manager recover ${op.id}`,
      alternative:
        'Use the official provider recovery route while retaining pending state.',
    });
  }
}
