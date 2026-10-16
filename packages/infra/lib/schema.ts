/**
 * Desired-state schema for OpenTofu inventory.
 * Every infrastructure resource is declared here; OpenTofu manages its resources.
 */
export type SecretSource =
  | { readonly source: "vault" }
  | { readonly source: "env" }
  | { readonly source: "github" }
  | { readonly source: "literal"; readonly value: string };

export type SecretSpec = {
  readonly name: string;
} & SecretSource;

export type CloudflareRedirectSpec = {
  readonly from: string;
  /** Prefer to_service; hostname used when set. */
  readonly to_service?: string;
  readonly to?: string;
  readonly status?: number;
};

export type CloudflareDnsRecordSpec = {
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly ttl?: number;
  readonly proxied?: boolean;
  readonly priority?: number;
};

export type CloudflareDnsConfig = {
  readonly proxied?: boolean;
  /** Records beyond the per-service and tunnel records OpenTofu derives. */
  readonly records?: Readonly<Record<string, CloudflareDnsRecordSpec>>;
};

export type CloudflareTunnelIngressSpec = {
  readonly service: string;
  readonly hostname?: string;
};

export type CloudflareAdditionalTunnelSpec = {
  readonly name: string;
  readonly config: { readonly ingress: readonly CloudflareTunnelIngressSpec[] };
};

export type CloudflareConfig = {
  readonly ssl_mode?: "off" | "flexible" | "full" | "strict";
  readonly placeholder_ipv4?: string;
  readonly dns?: CloudflareDnsConfig;
  readonly dns_settings?: { readonly nameservers?: { readonly type?: string } };
  readonly redirects?: readonly CloudflareRedirectSpec[];
  readonly additional_tunnels?: Readonly<Record<string, CloudflareAdditionalTunnelSpec>>;
};

export type RailwayServiceConfig = {
  readonly sleep?: boolean;
  readonly public?: boolean;
  readonly health_path?: string;
  readonly health_check?: boolean;
  readonly start_command?: string;
  readonly replicas?: number;
};

export type RailwayPlatformConfig = {
  /** OpenTofu-managed Railway project name. */
  readonly project: string;
  readonly environment: string;
  readonly region: string;
  readonly service_prefix?: string;
  readonly replicas?: number;
};

export type ServiceKind = "railway" | "tunnel";

export type ServiceSpec = {
  readonly id: string;
  readonly kind?: ServiceKind;
  readonly hostname?: string;
  readonly internal?: boolean;
  readonly standalone?: boolean;
  readonly railway?: RailwayServiceConfig;
  readonly github_repo?: string;
  readonly source_code_url?: string;
  readonly dockerfile?: string;
  readonly build_context?: string;
  readonly image?: string;
  readonly port?: number;
  readonly health_check?: boolean;
  readonly health_path?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly SecretSpec[];
  readonly depends_on?: readonly string[];
};

export type VaultKvConfig = {
  readonly mount: string;
  readonly project: string;
  readonly configs: readonly string[];
};

export type VaultInitConfig = {
  readonly key_shares: number;
  readonly key_threshold: number;
};

export type VaultUnsealConfig = {
  readonly on_deploy?: boolean;
};

export type VaultPolicySpec = {
  readonly name: string;
  readonly file: string;
};

export type VaultJwtRoleSpec = {
  readonly name: string;
  readonly policy: string;
  readonly bound_repos?: readonly string[];
  readonly bound_ref?: string;
  readonly ttl?: string;
  readonly max_ttl?: string;
  readonly audience?: string;
  readonly user_claim: string;
  readonly no_default_policy: boolean;
};

export type VaultJwtAuthSpec = {
  readonly path: string;
  readonly roles: readonly VaultJwtRoleSpec[];
};

export type VaultUserpassUserSpec = {
  readonly username: string;
  readonly policy: string;
};

export type VaultUserpassAuthSpec = {
  readonly users: readonly VaultUserpassUserSpec[];
};

export type VaultAuthConfig = {
  readonly jwt?: VaultJwtAuthSpec;
  readonly userpass?: VaultUserpassAuthSpec;
};

export type VaultTokenSpec = {
  readonly name: string;
  readonly policy: string;
  readonly period: string;
  readonly sink: string;
};

export type VaultKvKeySpec = {
  readonly name: string;
  readonly configs: readonly string[];
  readonly used_by?: readonly string[];
  readonly required?: boolean;
};

export type VaultConfig = {
  readonly hostname?: string;
  readonly kv: VaultKvConfig;
  readonly init?: VaultInitConfig;
  readonly unseal?: VaultUnsealConfig;
  readonly policies?: readonly VaultPolicySpec[];
  readonly auth?: VaultAuthConfig;
  readonly tokens?: readonly VaultTokenSpec[];
  readonly kv_keys?: readonly VaultKvKeySpec[];
};

export type GithubRepositorySpec = {
  readonly publisher_file?: string;
  readonly default_branch: string;
  readonly actions_secrets?: readonly string[];
};

export type GithubMergeGateConfig = {
  readonly repo_settings: { readonly default_branch: string };
  readonly ruleset: { readonly name: string; readonly enforcement: string };
};

export type GithubConfig = {
  readonly org: string;
  readonly infra_repo: string;
  /** Application repositories, keyed by repository name under `org`. */
  readonly repositories?: Readonly<Record<string, GithubRepositorySpec>>;
  readonly pr_ready?: GithubMergeGateConfig;
};

export type PostgresProjectSpec = {
  readonly id: string;
  readonly purpose: string;
  readonly secret_name: string;
  readonly application_secret: string;
  readonly organization: string;
  readonly name: string;
  readonly branch: string;
  readonly region: string;
  readonly cluster_size: string;
  readonly major_version: string;
  readonly replicas: number;
  readonly role_name: string;
  readonly inherited_roles: readonly string[];
};

export type PostgresConfig = {
  readonly projects: readonly PostgresProjectSpec[];
};

export type ObjectStoreSpec = {
  readonly id: string;
  readonly provider: "r2";
  readonly bucket?: string;
  readonly bucket_secret: string;
  readonly endpoint_secret: string;
  readonly region_secret: string;
  readonly access_key_secret: string;
  readonly secret_key_secret: string;
  /** App-owned key prefixes inside the shared bucket; omit or "" when multi-tenant. */
  readonly key_prefix?: string;
  readonly namespaces?: readonly string[];
};

export type TunnelLocalSpec = {
  readonly host: string;
  readonly port: number;
};

export type TunnelSpec = {
  readonly id: string;
  readonly provider: "cloudflare";
  readonly name: string;
  readonly hostname: string;
  readonly local: TunnelLocalSpec;
  readonly secrets?: readonly string[];
};

/** OpenTofu inventory consumed by documentation and builds. */
export type InfraConfig = {
  readonly domains?: Readonly<Record<string, import('./domains/model.js').DomainSpec>>;
  readonly zone: string;
  readonly image_owner: string;
  readonly default_image_tag: string;
  readonly image_prefix?: string;
  /** @deprecated Prefer github.infra_repo */
  readonly infra_github_repo?: string;
  readonly cloudflare?: CloudflareConfig;
  readonly railway: RailwayPlatformConfig;
  readonly github?: GithubConfig;
  readonly vault?: VaultConfig;
  readonly postgres?: PostgresConfig;
  readonly object_stores?: readonly ObjectStoreSpec[];
  readonly tunnels?: readonly TunnelSpec[];
  readonly services: readonly ServiceSpec[];
};

/** @deprecated Alias — use InfraConfig */
export type ServicesConfig = InfraConfig;
