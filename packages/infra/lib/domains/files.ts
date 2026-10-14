import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asRecord } from '../health/context.js';
import { domainName, type OperatorEvidence, type Snapshot } from './model.js';
import { parseRecords } from './records.js';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function directory(repo: string, domain: string): string {
  return join(repo, '.domain-migration', domainName(domain));
}

export function privateJson(path: string, value: unknown): void {
  // Exclusive creation protects the original rollback evidence from reruns.
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

export function initialize(repo: string, domain: string): string {
  const dir = directory(repo, domain);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const shared = join(repo, '.domain-migration/account-operator.json');
  if (!existsSync(shared)) privateJson(shared, { accountRecoveryReview: '', billingReview: '', retirementReview: '' });
  if (!existsSync(join(dir, 'operator.json'))) privateJson(join(dir, 'operator.json'), {
    sourceReview: '', dependenciesReview: '', accountRecoveryReview: '',
    transferEligibilityReview: '', billingReview: '', mailRoundTripReview: '', retirementReview: '',
    freezeStartedAt: '', dsAbsentSince: '', delegationChangedAt: '',
  } satisfies OperatorEvidence);
  if (!existsSync(join(dir, 'source-records.json'))) privateJson(join(dir, 'source-records.json'), { records: [] });
  return dir;
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function evidence(repo: string, domain: string): OperatorEvidence {
  const raw = asRecord(readJson(join(directory(repo, domain), 'operator.json')));
  const keys: readonly (keyof OperatorEvidence)[] = ['sourceReview', 'dependenciesReview', 'accountRecoveryReview',
    'transferEligibilityReview', 'billingReview', 'mailRoundTripReview', 'retirementReview',
    'freezeStartedAt', 'dsAbsentSince', 'delegationChangedAt'];
  if (keys.some((key) => typeof raw[key] !== 'string')) throw new Error('operator.json: every evidence field must be a string');
  const dir = directory(repo, domain);
  const sharedPath = join(repo, '.domain-migration/account-operator.json');
  const shared = existsSync(sharedPath) ? asRecord(readJson(sharedPath)) : {};
  const common: Record<string, string> = {};
  for (const key of ['accountRecoveryReview', 'billingReview', 'retirementReview']) {
    if (shared[key] !== undefined && typeof shared[key] !== 'string') throw new Error('account-operator.json: evidence fields must be strings');
    if (!String(raw[key]).trim() && typeof shared[key] === 'string') common[key] = shared[key];
  }
  const freeze = existsSync(join(dir, 'freeze.json')) ? asRecord(readJson(join(dir, 'freeze.json'))) : {};
  const observations = existsSync(join(dir, 'observations.json')) ? asRecord(readJson(join(dir, 'observations.json'))) : {};
  return { ...raw, ...common, ...freeze,
    ...(observations.baselineHash ? { dsAbsentSince: String(observations.dsAbsentSince ?? ''), delegationChangedAt: String(observations.delegationChangedAt ?? '') } : {}),
  } as OperatorEvidence;
}

export function baseline(repo: string, domain: string): Snapshot {
  const raw = asRecord(readJson(join(directory(repo, domain), 'baseline.json')));
  if (raw.version !== 1 || raw.domain !== domain || !Number.isFinite(Date.parse(String(raw.capturedAt))) ||
    !Array.isArray(raw.sourceNameservers) || raw.sourceNameservers.length < 2 ||
    !['cloudflare', 'operator-export', 'retired-unused'].includes(String(raw.source)) || !Number.isFinite(raw.maxObservedTtl)) {
    throw new Error('Invalid baseline.json; restore the original observation');
  }
  return { ...raw, records: parseRecords(raw.records, domain) } as unknown as Snapshot;
}
