import type { StateStore, Vault, VaultItem } from '../domain/ports.ts';
import { safeCode } from '../domain/errors.ts';
export interface Finding {
  accountId: string | null;
  kind: string;
  status: 'finding' | 'unknown';
  priority: number;
}
export async function audit(input: {
  state: StateStore;
  vault: Vault | null;
  network: boolean;
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const account of input.state.list('accounts')) {
    if (account.vaultIds.length === 0)
      findings.push({
        accountId: account.id,
        kind: 'incomplete-migration',
        status: 'finding',
        priority: account.priority,
      });
    if (account.credential !== 'verified')
      findings.push({
        accountId: account.id,
        kind: 'credential-validity',
        status: 'unknown',
        priority: account.priority,
      });
    if (account.mfa === 'unknown')
      findings.push({
        accountId: account.id,
        kind: 'mfa',
        status: 'unknown',
        priority: account.priority,
      });
    if (account.recovery === 'unknown')
      findings.push({
        accountId: account.id,
        kind: 'recovery',
        status: 'unknown',
        priority: account.priority,
      });
  }
  findings.push(...reviewCandidates(input.state));
  findings.push(...(await vaultFindings(input)));
  for (const source of input.state
    .list('coverage')
    .filter((c) => c.state !== 'scanned')) {
    findings.push({
      accountId: null,
      kind: `source-${source.state}`,
      status: 'unknown',
      priority: 90,
    });
  }
  return findings.sort((a, b) => b.priority - a.priority);
}
/** Equality only in process memory; no persisted password-derived fingerprints. */
function localHealth(state: StateStore, items: VaultItem[]): Finding[] {
  const findings: Finding[] = [];
  for (const account of state.list('accounts')) {
    for (const id of account.vaultIds) {
      const password = items.find((i) => i.id === id)?.login?.password;
      if (!password) continue;
      if (password.length < 16)
        findings.push({
          accountId: account.id,
          kind: 'local-length-heuristic-weak',
          status: 'finding',
          priority: 95,
        });
      if (items.some((i) => i.id !== id && i.login?.password === password))
        findings.push({
          accountId: account.id,
          kind: 'reused',
          status: 'finding',
          priority: 100,
        });
    }
  }
  return findings;
}

function reportFindings(
  state: StateStore,
  raw: unknown,
  network: boolean
): Finding[] {
  if (!Array.isArray(raw))
    return [
      {
        accountId: null,
        kind: 'password-health-report',
        status: 'unknown',
        priority: 100,
      },
    ];
  const findings: Finding[] = [];
  for (const account of state.list('accounts')) {
    for (const id of account.vaultIds) {
      const report = raw.find((item: { id?: string }) => item.id === id) as
        | {
            exposed?: boolean;
            exposedError?: unknown;
            passwordStrength?: number;
            reuseCount?: number;
          }
        | undefined;
      if (!report) continue;
      if (report.exposed === true)
        findings.push({
          accountId: account.id,
          kind: 'exposed',
          status: 'finding',
          priority: 100,
        });
      if (!network || report.exposedError)
        findings.push({
          accountId: account.id,
          kind: 'exposure',
          status: 'unknown',
          priority: 90,
        });
      if (
        typeof report.passwordStrength === 'number' &&
        report.passwordStrength < 3
      )
        findings.push({
          accountId: account.id,
          kind: 'weak',
          status: 'finding',
          priority: 95,
        });
    }
  }
  return findings;
}

async function vaultFindings(input: {
  state: StateStore;
  vault: Vault | null;
  network: boolean;
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (input.vault) {
    try {
      findings.push(...localHealth(input.state, await input.vault.list()));
    } catch {
      findings.push({
        accountId: null,
        kind: 'vault-health-unavailable',
        status: 'unknown',
        priority: 100,
      });
    }
    try {
      findings.push(
        ...reportFindings(
          input.state,
          await input.vault.health(input.network),
          input.network
        )
      );
    } catch (error) {
      findings.push({
        accountId: null,
        kind: `bitwarden-report-${safeCode(error)}`,
        status: 'unknown',
        priority: 100,
      });
    }
  }
  return findings;
}

function reviewCandidates(state: StateStore): Finding[] {
  return state.list('accounts').flatMap((account) => [
    {
      accountId: account.id,
      kind: 'account-activity-unknown-review-before-closure',
      status: 'unknown' as const,
      priority: 10,
    },
    ...(account.vaultIds.length > 1
      ? [
          {
            accountId: account.id,
            kind: 'duplicate-vault-items-review',
            status: 'finding' as const,
            priority: 60,
          },
        ]
      : []),
    ...(account.credential === 'stale'
      ? [
          {
            accountId: account.id,
            kind: 'verification-stale-after-vault-revision-change',
            status: 'unknown' as const,
            priority: 90,
          },
        ]
      : []),
  ]);
}
