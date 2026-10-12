/** Offline consistency of the OpenTofu inventory; needs no network or credentials. */
import { join } from "node:path";
import { infraGithubRepo, isTunnelService, vaultConfigOrDefault } from "../services.js";
import type { HealthContext } from "./context.js";
import { fail, pass, type CheckResult } from "./report.js";
import { duplicates, missingFrom } from "./targets.js";

function verdict(name: string, problems: readonly string[], ok: string): CheckResult {
  return problems.length === 0 ? pass(name, ok) : fail(name, problems.join("; "));
}

function hostnameChecks(ctx: HealthContext): CheckResult[] {
  const { config } = ctx;
  const hostnames = config.services.flatMap((service) => (service.hostname ? [service.hostname] : []));
  const recordNames = Object.values(config.cloudflare?.dns?.records ?? {})
    .filter((record) => record.type === "A" || record.type === "CNAME")
    .map((record) => record.name);
  const outside = hostnames.filter((hostname) => hostname !== config.zone && !hostname.endsWith(`.${config.zone}`));
  return [
    verdict(
      "service ids unique",
      duplicates(config.services.map((service) => service.id)).map((id) => `duplicate id ${id}`),
      `${config.services.length} services`,
    ),
    verdict(
      "hostnames unique",
      duplicates([...hostnames, ...recordNames]).map((hostname) => `${hostname} is declared more than once`),
      `${hostnames.length} service hostnames, ${recordNames.length} additional records`,
    ),
    verdict(
      "hostnames in zone",
      outside.map((hostname) => `${hostname} is outside ${config.zone}`),
      `all under ${config.zone}`,
    ),
  ];
}

function referenceChecks(ctx: HealthContext): CheckResult[] {
  const { config } = ctx;
  const redirects = config.cloudflare?.redirects ?? [];
  const brokenRedirects = redirects.flatMap((redirect) => {
    if (redirect.to) return [];
    const target = config.services.find((service) => service.id === redirect.to_service);
    return target?.hostname ? [] : [`redirect from ${redirect.from} targets unknown service ${redirect.to_service}`];
  });

  const tunnels = config.tunnels ?? [];
  const brokenTunnels = config.services.filter(isTunnelService).flatMap((service) => {
    const tunnel = tunnels.find((candidate) => candidate.id === service.id);
    if (!tunnel) return [`tunnel service ${service.id} has no tunnels[] entry`];
    return tunnel.hostname === service.hostname ? [] : [`tunnel ${service.id} hostname differs from its service`];
  });

  const infraRepo = infraGithubRepo(config);
  const org = config.github?.org ?? infraRepo.split("/")[0];
  const managed = new Set([infraRepo, ...Object.keys(config.github?.repositories ?? {}).map((name) => `${org}/${name}`)]);
  const unmanaged = config.services.flatMap((service) =>
    service.github_repo && !managed.has(service.github_repo)
      ? [`${service.id} builds from unmanaged repository ${service.github_repo}`]
      : [],
  );

  return [
    verdict("redirect targets", brokenRedirects, `${redirects.length} redirect(s) resolve to a service`),
    verdict("tunnel services", brokenTunnels, `${tunnels.length} managed tunnel(s) match their service`),
    verdict("service repositories", unmanaged, `every service builds from one of ${managed.size} managed repositories`),
  ];
}

function vaultChecks(ctx: HealthContext): CheckResult[] {
  const vault = vaultConfigOrDefault(ctx.config);
  const policies = vault.policies ?? [];
  const missingFiles = policies
    .filter((policy) => !ctx.fileExists(join(ctx.repoRoot, policy.file)))
    .map((policy) => `policy ${policy.name} file ${policy.file} is missing`);
  const referenced = [
    ...(vault.auth?.jwt?.roles ?? []).map((role) => role.policy),
    ...(vault.auth?.userpass?.users ?? []).map((user) => user.policy),
    ...(vault.tokens ?? []).map((token) => token.policy),
  ];
  const undeclared = missingFrom(referenced, policies.map((policy) => policy.name)).map(
    (name) => `policy ${name} is referenced but not declared`,
  );
  const stores = ctx.config.object_stores ?? [];
  const orphanNamespaces = stores.flatMap((store) =>
    missingFrom(store.namespaces ?? [], vault.kv.configs).map(
      (namespace) => `object store ${store.id} namespace ${namespace} has no Vault KV config`,
    ),
  );
  return [
    verdict("vault policies", [...missingFiles, ...undeclared], `${policies.length} policies declared with files`),
    verdict(
      "object stores",
      [...duplicates(stores.map((store) => store.bucket ?? store.id)).map((bucket) => `duplicate bucket ${bucket}`), ...orphanNamespaces],
      `${stores.length} bucket(s) mapped to Vault KV configs`,
    ),
  ];
}

export async function checkInventory(ctx: HealthContext): Promise<readonly CheckResult[]> {
  return [...hostnameChecks(ctx), ...referenceChecks(ctx), ...vaultChecks(ctx)];
}
