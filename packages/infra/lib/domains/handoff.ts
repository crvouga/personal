import { renameSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthContext } from '../health/context.js';
import { nameserverAction, type AutomationReport } from './automation.js';
import type { CampaignReport } from './campaign.js';
import { evidence, privateJson } from './files.js';
import { authCode } from './transfers.js';

/** Generated from actual observations; never fills in owner claims. */
export async function handoff(ctx: HealthContext, report: CampaignReport, automation: AutomationReport): Promise<string> {
  const domains = [];
  for (const [domain, spec] of Object.entries(ctx.config.domains ?? {})) {
    let missingEvidence: string[] = [];
    try {
      const values = evidence(ctx.repoRoot, domain);
      missingEvidence = ['dependenciesReview', 'accountRecoveryReview', 'transferEligibilityReview', 'billingReview', 'mailRoundTripReview', 'retirementReview']
        .filter((key) => spec.dns_migration !== 'retire-unused' || !['dependenciesReview', 'mailRoundTripReview'].includes(key))
        .filter((key) => !values[key as keyof typeof values]?.trim());
    } catch { missingEvidence = ['operator.json not available']; }
    let ownerCodePresent = false;
    try { authCode(ctx, domain); ownerCodePresent = true; } catch { /* report presence only */ }
    domains.push({ domain, availability: spec.availability, nameservers: await nameserverAction(ctx, domain), ownerCodePresent,
      optionalOwnerFindingsNotRecorded: missingEvidence, progress: automation.progress.find((row) => row.domain === domain),
      blockers: report.blockers.filter((row) => row.domain === domain) });
  }
  const path = join(ctx.repoRoot, '.domain-migration/next-actions.json');
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  privateJson(temporary, {
    observedAt: ctx.now().toISOString(), status: report.status, automation,
    ownerBoundary: 'Squarespace unlock, newest EPP-code request, parent DS and nameserver changes require supported authenticated owner access. No configured adapter covers this account. Never cancel a domain to release it.',
    resume: 'bun migrate-domains-to-cloudflare',
    authorizationCodeInput: 'Owner-only .domain-migration/auth-codes.json, or DOMAIN_AUTH_CODES_FILE, or secure TF_VAR_domain_auth_codes; domain-to-raw-code JSON object. Values are never copied into this report.',
    evidenceInput: '.domain-migration/<domain>/operator.json: optional dated owner findings; sourceReview remains mandatory only for an external operator-export baseline. Missing owner reviews stay SKIP and do not require clerical sign-off. Never mark unavailable evidence as complete.',
    accountEvidenceInput: '.domain-migration/account-operator.json: accountRecoveryReview, billingReview and retirementReview apply across this account; per-domain findings override them.',
    domains,
  });
  renameSync(temporary, path);
  return path;
}
