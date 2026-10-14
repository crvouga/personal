/** Migration policy lives only in the OpenTofu inventory. Snapshots are observations. */
export type DomainSpec = {
  readonly availability: 'critical' | 'best-effort';
  readonly dns_migration: 'preserve' | 'retire-unused';
  readonly forwarding_enabled: boolean;
  readonly forwarding: readonly ForwardingSpec[];
  readonly web_usage: 'required' | 'none';
  readonly manage_zone: boolean;
  readonly existing_zone_id?: string;
  readonly records: Readonly<Record<string, DnsRecord>>;
  readonly dnssec_status: 'disabled' | 'active';
  readonly manage_registration: boolean;
  readonly transfer_enabled?: boolean;
  readonly https: readonly { readonly url: string; readonly status: number; readonly location?: string }[];
  /** At least the old delegation/negative-cache TTL; never less than 48 hours. */
  readonly settle_seconds: number;
};

export type ForwardingSpec = {
  readonly hostname: string;
  readonly target: string;
  readonly status: 301 | 302;
  readonly preserve_path: boolean;
  readonly preserve_query: boolean;
};

export type DnsRecord = {
  readonly id?: string;
  readonly name: string;
  readonly type: string;
  readonly content?: string;
  readonly data?: Readonly<Record<string, string | number>>;
  readonly ttl: number;
  readonly proxied: boolean;
  readonly priority?: number;
  readonly settings?: Readonly<Record<string, boolean>>;
};

export type Zone = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly name_servers: readonly string[];
};

export type Snapshot = {
  readonly version: 1;
  readonly domain: string;
  readonly capturedAt: string;
  readonly source: 'cloudflare' | 'operator-export' | 'retired-unused';
  readonly sourceNameservers: readonly string[];
  readonly records: readonly DnsRecord[];
  readonly zone?: Zone;
  readonly maxObservedTtl: number;
  readonly sourceWarnings?: readonly string[];
};

/** These are human evidence, never inferred from successful HTTP or DNS probes. */
export type OperatorEvidence = {
  readonly sourceReview: string;
  readonly dependenciesReview: string;
  readonly accountRecoveryReview: string;
  readonly transferEligibilityReview: string;
  readonly billingReview: string;
  readonly mailRoundTripReview: string;
  readonly retirementReview: string;
  readonly freezeStartedAt: string;
  readonly dsAbsentSince: string;
  readonly delegationChangedAt: string;
};

export type Stage = 'source' | 'baseline' | 'cutover' | 'forwarding' | 'dns-live' | 'transfer' | 'secure' | 'complete';
export const STAGES: readonly Stage[] = ['source', 'baseline', 'cutover', 'forwarding', 'dns-live', 'transfer', 'secure', 'complete'];
export const RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const;
export const normalizeName = (value: string): string => value.toLowerCase().replace(/\.$/, '');

export function domainName(value: string): string {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) || value.length > 253) {
    throw new Error('Use a lowercase, fully qualified domain name (Punycode for international names)');
  }
  return value;
}

export function validateSpec(domain: string, spec: DomainSpec): void {
  domainName(domain);
  if (!['critical', 'best-effort'].includes(spec.availability)) throw new Error('Explicit availability policy required');
  if (!['preserve', 'retire-unused'].includes(spec.dns_migration) || (spec.availability === 'critical' && spec.dns_migration !== 'preserve')) throw new Error('Critical DNS must be preserved; retirement requires an explicit unused-domain policy');
  if (!Number.isInteger(spec.settle_seconds) || spec.settle_seconds < 172800) {
    throw new Error(`${domain}: settle_seconds must be at least 172800 (48 hours)`);
  }
  if (!['disabled', 'active'].includes(spec.dnssec_status)) throw new Error('Invalid dnssec_status');
  if (!['required', 'none'].includes(spec.web_usage) || (spec.web_usage === 'none' && spec.https.length)) throw new Error('Declare required web checks or explicitly no web usage');
  for (const redirect of spec.forwarding) {
    const target = new URL(redirect.target);
    if (!(redirect.hostname === domain || redirect.hostname.endsWith(`.${domain}`)) || !['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Invalid forwarding host or target');
    if (redirect.preserve_path && (target.pathname !== '/' || redirect.target.endsWith('/'))) throw new Error('Path-preserving target must be an origin without trailing slash');
  }
  for (const endpoint of spec.https) {
    const url = new URL(endpoint.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
      throw new Error(`${domain}: HTTPS checks must be credential-free URLs within the domain`);
    }
    if (!Number.isInteger(endpoint.status) || endpoint.status < 200 || endpoint.status > 399) {
      throw new Error('HTTPS checks require an explicit 2xx or 3xx status');
    }
  }
}
