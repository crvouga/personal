import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, hotAssert, type Assert } from "@pkgs/assert";

const ha: Assert = hotAssert();

export type {
  CloudflareConfig,
  CloudflareRedirectSpec,
  GithubConfig,
  InfraConfig,
  PostgresConfig,
  ObjectStoreSpec,
  RailwayPlatformConfig,
  RailwayServiceConfig,
  SecretSource,
  SecretSpec,
  ServiceKind,
  ServiceSpec,
  ServicesConfig,
  TunnelSpec,
  VaultConfig,
  VaultKvKeySpec,
} from "./schema.js";

import type {
  CloudflareConfig,
  GithubConfig,
  InfraConfig,
  ServiceSpec,
  ServicesConfig,
  VaultConfig,
} from "./schema.js";

export function zoneSlug(zone: string): string {
  assert.nonEmptyString(zone, "zone must be non-empty");
  const slug = zone.replace(/\./g, "-");
  assert.nonEmptyString(slug, "zone slug must be non-empty");
  return slug;
}

export function imagePrefix(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  assert.nonEmptyString(config.zone, "zone must be non-empty");
  const prefix = config.image_prefix?.trim() || zoneSlug(config.zone);
  assert.nonEmptyString(prefix, "image prefix must be non-empty");
  return prefix;
}

export function vaultHostname(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const explicit = config.vault?.hostname?.trim();
  if (explicit) {
    assert.nonEmptyString(explicit, "vault hostname must be non-empty");
    return explicit;
  }
  assert.nonEmptyString(config.zone, "zone must be non-empty");
  return `vault.${config.zone}`;
}

export function vaultAddr(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const addr = `https://${vaultHostname(config)}`;
  assert.ok(addr.startsWith("https://"), "vault addr must be https", { addr });
  return addr;
}

export function vaultConfigOrDefault(config: ServicesConfig): VaultConfig {
  assert.record(config, "services config must be a record");
  if (config.vault) return config.vault;
  return {
    kv: { mount: "secret", project: "personal", configs: ["dev", "prd"] },
  };
}

export function railwayProjectName(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const project = config.railway?.project?.trim();
  if (!project) throw new Error("OpenTofu inventory: railway.project is required");
  assert.nonEmptyString(project, "OpenTofu inventory railway.project must be non-empty");
  return project;
}

export function railwayEnvironmentName(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const name = config.railway?.environment?.trim() || "production";
  assert.nonEmptyString(name, "railway environment name must be non-empty");
  return name;
}

export function railwayRegion(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const region = config.railway?.region?.trim() || "us-east4";
  assert.nonEmptyString(region, "railway region must be non-empty");
  return region;
}

export function railwayServicePrefix(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const prefix = config.railway?.service_prefix?.trim() ?? "";
  assert.string(prefix, "railway service prefix must be a string");
  return prefix;
}

export function railwaySleep(service: ServiceSpec): boolean {
  assert.record(service, "service spec must be a record");
  assert.nonEmptyString(service.id, "service id must be non-empty");
  return service.railway?.sleep !== false;
}

export function serviceHealthPath(service: ServiceSpec): string | undefined {
  assert.record(service, "service spec must be a record");
  assert.nonEmptyString(service.id, "service id must be non-empty");
  if (service.health_check === false) return undefined;
  const path = service.health_path ?? "/";
  assert.nonEmptyString(path, "service health path must be non-empty");
  return path;
}

export function infraGithubRepo(config: ServicesConfig): string {
  assert.record(config, "services config must be a record");
  const fromGithub = config.github?.infra_repo?.trim();
  if (fromGithub) {
    assert.nonEmptyString(fromGithub, "github.infra_repo must be non-empty");
    return fromGithub;
  }
  const repo = config.infra_github_repo?.trim();
  if (!repo) throw new Error("OpenTofu inventory: github.infra_repo (or infra_github_repo) is required");
  assert.nonEmptyString(repo, "OpenTofu inventory infra_github_repo must be non-empty");
  return repo;
}

export function isPublicService(service: ServiceSpec): boolean {
  assert.record(service, "service spec must be a record");
  assert.nonEmptyString(service.id, "service id must be non-empty");
  return service.internal !== true;
}

export function isRailwayService(service: ServiceSpec): boolean {
  assert.record(service, "service spec must be a record");
  return (service.kind ?? "railway") === "railway";
}

export function isTunnelService(service: ServiceSpec): boolean {
  assert.record(service, "service spec must be a record");
  return service.kind === "tunnel";
}

export function isAlwaysOn(service: ServiceSpec): boolean {
  assert.record(service, "service spec must be a record");
  assert.nonEmptyString(service.id, "service id must be non-empty");
  return !railwaySleep(service);
}

function validateService(service: ServiceSpec): void {
  ha.record(service, "service spec must be a record");
  ha.nonEmptyString(service.id, "service id must be non-empty");
  const kind = service.kind ?? "railway";

  if (kind === "tunnel") {
    if (!service.hostname) {
      throw new Error(`Tunnel service "${service.id}" missing hostname`);
    }
    return;
  }

  if (!service.github_repo || !service.source_code_url) {
    throw new Error(`Service "${service.id}" missing github_repo or source_code_url`);
  }
  if (!service.dockerfile || service.build_context === undefined) {
    throw new Error(`Service "${service.id}" missing dockerfile or build_context`);
  }
  if (service.internal) {
    if (service.hostname) {
      throw new Error(`Service "${service.id}" is internal but has hostname`);
    }
  } else if (service.railway?.public !== false) {
    if (!service.hostname) {
      throw new Error(`Service "${service.id}" missing hostname`);
    }
    if (service.port == null) {
      throw new Error(`Service "${service.id}" missing port`);
    }
  }
}

export function loadServicesConfig(
  path = join(import.meta.dirname, "..", "tofu/modules/inventory/inventory.tf.json"),
): InfraConfig {
  assert.nonEmptyString(path, "services config path must be non-empty");
  const raw = (JSON.parse(readFileSync(path, "utf8")) as { locals: { inventory: InfraConfig } }).locals.inventory;
  assert.record(raw, "services config must be a record");
  if (!raw?.zone?.trim()) {
    throw new Error(`Invalid services config at ${path}: zone is required`);
  }
  assert.nonEmptyString(raw.zone.trim(), "services config zone must be non-empty");
  if (!raw?.railway?.project?.trim() || !raw?.railway?.region?.trim()) {
    throw new Error(
      `Invalid services config at ${path}: railway.project and railway.region are required`,
    );
  }
  if (!raw?.services?.length) {
    throw new Error(`Invalid services config at ${path}`);
  }
  assert.nonEmptyArray(raw.services, "services config services must be non-empty");
  for (const service of raw.services) {
    validateService(service);
  }
  return raw;
}

export function findService(
  config: ServicesConfig,
  id: string,
): ServiceSpec | undefined {
  assert.record(config, "services config must be a record");
  assert.nonEmptyString(id, "service id must be non-empty");
  assert.array(config.services, "services must be an array");
  return config.services.find((s) => s.id === id);
}

export type DnsTarget = { readonly id: string; readonly hostname: string };

export function deployableServices(config: ServicesConfig): readonly ServiceSpec[] {
  assert.record(config, "services config must be a record");
  assert.array(config.services, "services must be an array");
  const services = config.services.filter(
    (service) => isRailwayService(service) && !service.standalone,
  );
  assert.array(services, "deployable services must be an array");
  return services;
}
