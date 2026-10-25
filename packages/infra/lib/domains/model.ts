/** Domain ownership and DNS policy live only in the OpenTofu inventory. */
export type DomainSpec = {
  readonly availability: 'critical' | 'best-effort';
  readonly domain_manager: 'squarespace';
  readonly registrar_iana_id: string;
  readonly nameservers: readonly string[];
  readonly web_usage: 'required' | 'none';
  readonly manage_zone: boolean;
  readonly existing_zone_id?: string;
  readonly records: Readonly<Record<string, DnsRecord>>;
  readonly dnssec_status: 'disabled' | 'active';
  readonly ssl_mode?: 'full' | 'strict';
  readonly https: readonly { readonly url: string; readonly status: number; readonly location?: string }[];
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

export const RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const;
export const normalizeName = (value: string): string => value.toLowerCase().replace(/\.$/, '');

export function validateSpec(domain: string, spec: DomainSpec): void {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253) throw new Error('Invalid domain name');
  if (spec.domain_manager !== 'squarespace' || !/^[0-9]+$/.test(spec.registrar_iana_id)) throw new Error('Retain Squarespace domain management and the existing registrar identity');
  if (!['critical', 'best-effort'].includes(spec.availability)) throw new Error('Explicit availability policy required');
  if (spec.nameservers.length < 2) throw new Error('Existing nameservers must be declared');
  if (!['disabled', 'active'].includes(spec.dnssec_status)) throw new Error('Invalid DNSSEC policy');
  if (spec.availability === 'critical' && (spec.web_usage !== 'required' || spec.https.length < 2)) throw new Error('Critical domains require apex and www probes');
  for (const endpoint of spec.https) {
    const url = new URL(endpoint.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new Error('Invalid domain HTTPS probe');
  }
}
