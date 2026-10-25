/** What the inventory declares, reduced to the hostnames and images checks probe. */
import type { InfraConfig, ServiceSpec } from "../schema.js";
import { imagePrefix, isPublicService, isRailwayService } from "../services.js";

const TUNNEL_TARGET_SUFFIX = ".cfargotunnel.com";

/** Railway services reachable at their own hostname. */
export function publicRailwayServices(config: InfraConfig): readonly ServiceSpec[] {
  return config.services.filter(
    (service) =>
      isRailwayService(service) && isPublicService(service) && service.railway?.public !== false && !!service.hostname,
  );
}

/**
 * Every hostname served through a Cloudflare tunnel: the managed tunnels, the
 * remotely configured ingress rules, and records that point at a tunnel.
 */
export function tunnelHostnames(config: InfraConfig): readonly string[] {
  const hostnames = new Set<string>();
  for (const tunnel of config.tunnels ?? []) hostnames.add(tunnel.hostname);
  for (const tunnel of Object.values(config.cloudflare?.additional_tunnels ?? {})) {
    for (const rule of tunnel.config.ingress) if (rule.hostname) hostnames.add(rule.hostname);
  }
  for (const record of Object.values(config.cloudflare?.dns?.records ?? {})) {
    if (record.type === "CNAME" && record.content.endsWith(TUNNEL_TARGET_SUFFIX)) hostnames.add(record.name);
  }
  return [...hostnames].sort();
}

/** Hostnames Cloudflare answers only to redirect elsewhere. */
export function redirectHostnames(config: InfraConfig): readonly string[] {
  return [...new Set((config.cloudflare?.redirects ?? []).map((redirect) => redirect.from))];
}

/** Every hostname that must present a valid certificate. */
export function httpsHostnames(config: InfraConfig): readonly string[] {
  return [
    ...new Set([
      ...publicRailwayServices(config).map((service) => service.hostname as string),
      ...(config.aliases ?? []).map((alias) => alias.hostname),
      ...tunnelHostnames(config),
      ...redirectHostnames(config),
    ]),
  ];
}

/** The image reference OpenTofu deploys for a service at the default tag. */
export function serviceImage(config: InfraConfig, service: ServiceSpec): string {
  return (
    service.image ??
    `ghcr.io/${config.image_owner}/${imagePrefix(config)}-${service.id}:${config.default_image_tag}`
  );
}

export function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort();
}

export function missingFrom(required: readonly string[], present: readonly string[]): readonly string[] {
  const have = new Set(present);
  return [...new Set(required)].filter((name) => !have.has(name)).sort();
}
