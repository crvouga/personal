import type { Account, Evidence, MigrationIssue } from '../domain/model.ts';
import type { StateStore } from '../domain/ports.ts';
import { requireAction } from './actions.ts';
export function migrationIssues(
  state: StateStore,
  account: Account,
  candidates: Evidence[]
): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  for (const evidence of candidates) {
    const reason = issueReason(state, account, evidence, candidates.length);
    if (!reason) continue;
    const issue = { accountId: account.id, evidenceId: evidence.id, reason };
    issues.push(issue);
    requireAction(state, {
      accountId: account.id,
      sourceId: evidence.sourceId,
      operationId: null,
      runId: null,
      step: `migration-${evidence.id}`,
      reason,
      destination: account.origin,
      instructions: migrationInstructions(evidence, reason),
      prerequisites: [
        'Keep the original export and current vault item intact.',
      ],
      expiresAt: null,
      detection:
        'Selected import readback verifies the mapped item; unsupported passkeys/attachments remain explicit transfer work.',
      resume: `bun run password-manager evidence list --source ${evidence.sourceId}`,
      alternative:
        'Use the source application’s supported native credential transfer. Never treat a password CSV as a complete passkey/attachment export.',
    });
  }
  return issues;
}
function issueReason(
  state: StateStore,
  account: Account,
  evidence: Evidence,
  count: number
): MigrationIssue['reason'] | null {
  if (state.get('imports', evidence.id)) return null;
  if (evidence.unsupported.length) return 'unsupported-transfer-fields';
  if (count > 1) return 'conflicting-import-candidates';
  if (account.vaultIds.length) return 'existing-vault-credential-preserved';
  return null;
}
function migrationInstructions(evidence: Evidence, reason: string): string[] {
  const instructions = [
    `1. Inspect evidence ${evidence.id} and the selected account with accounts show ACCOUNT_ID. No source password will replace the current credential automatically.`,
    `2. For an existing destination run imports resolve ${evidence.id} --vault-item VAULT_ID --mode merge-metadata, replace-password, or preserve; inspect the resulting plan before apply. replace-password is an explicit choice to replace a current credential with this source candidate.`,
    `3. For conflicting export candidates with no vault item, select one with imports choose ${evidence.id}; apply only that plan. Other candidates remain encrypted and unresolved.`,
  ];
  if (reason !== 'unsupported-transfer-fields') return instructions;
  return [
    ...instructions,
    `4. Unsupported transfer categories: ${evidence.unsupported.join(', ')}. For a folder mapping use imports configure ${evidence.id} --folder-id EXISTING_FOLDER_ID (or none); --personal explicitly selects personal ownership. Discard unsent plans before changing a mapping.`,
    '5. CSV custom fields require a supported JSON export. Export from the source application and add it as a separate bitwarden-json source, then discover again.',
    '6. Transfer passkeys through supported native credential exchange or enroll a new passkey and test it before removing the original. Download attachments from the original authenticated application and add them to the verified destination item; keep the original until each attachment is checked. A password-only import remains incomplete for these fields.',
  ];
}
