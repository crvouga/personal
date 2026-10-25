/** Public DNS answers match what the inventory declares. */
import type { CloudflareDnsRecordSpec } from "../schema.js";
import { errorMessage, mapLimit, type HealthContext } from "./context.js";
import { fail, pass, type CheckResult } from "./report.js";
import { publicRailwayServices, redirectHostnames, tunnelHostnames } from "./targets.js";

const CONCURRENCY = 8;
const normalize = (name: string): string => name.toLowerCase().replace(/\.$/, "");

async function attempt(name: string, probe: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await probe();
  } catch (err) {
    return fail(name, errorMessage(err));
  }
}

function nameservers(ctx: HealthContext): Promise<CheckResult> {
  const name = `NS ${ctx.config.zone}`;
  return attempt(name, async () => {
    const servers = (await ctx.dns.resolveNs(ctx.config.zone)).map(normalize);
    const expectCloudflare = (ctx.config.cloudflare?.dns_settings?.nameservers?.type ?? "").startsWith("cloudflare");
    const foreign = servers.filter((server) => !server.endsWith(".ns.cloudflare.com"));
    if (servers.length === 0) return fail(name, "no nameservers");
    if (expectCloudflare && foreign.length > 0) return fail(name, `not delegated to Cloudflare: ${foreign.join(", ")}`);
    return pass(name, servers.join(", "));
  });
}

/** Railway custom domains are unproxied CNAMEs; a flattened answer still resolves. */
function serviceRecord(ctx: HealthContext, hostname: string): Promise<CheckResult> {
  const name = `CNAME ${hostname}`;
  return attempt(name, async () => {
    const targets = await ctx.dns.resolveCname(hostname).catch(() => [] as readonly string[]);
    if (targets.length > 0) return pass(name, `→ ${targets.map(normalize).join(", ")}`);
    const addresses = await ctx.dns.resolve4(hostname);
    return addresses.length > 0 ? pass(name, `resolves to ${addresses.join(", ")}`) : fail(name, "does not resolve");
  });
}

function proxiedHost(ctx: HealthContext, hostname: string): Promise<CheckResult> {
  const name = `A ${hostname}`;
  return attempt(name, async () => {
    const addresses = await ctx.dns.resolve4(hostname);
    return addresses.length > 0 ? pass(name, `resolves to ${addresses.join(", ")}`) : fail(name, "does not resolve");
  });
}

async function recordAnswers(ctx: HealthContext, record: CloudflareDnsRecordSpec): Promise<readonly string[]> {
  if (record.type === "A") return ctx.dns.resolve4(record.name);
  if (record.type === "CNAME") return (await ctx.dns.resolveCname(record.name)).map(normalize);
  if (record.type === "TXT") return ctx.dns.resolveTxt(record.name);
  if (record.type === "MX") {
    return (await ctx.dns.resolveMx(record.name)).map((mx) => `${mx.priority} ${normalize(mx.exchange)}`);
  }
  throw new Error(`unsupported record type ${record.type}`);
}

/** Proxied records answer with Cloudflare addresses, so only resolution is comparable. */
function declaredRecord(ctx: HealthContext, record: CloudflareDnsRecordSpec): Promise<CheckResult> {
  const name = `${record.type} ${record.name}`;
  return attempt(name, async () => {
    if (record.proxied) {
      const addresses = await ctx.dns.resolve4(record.name);
      return addresses.length > 0 ? pass(name, "proxied; resolves") : fail(name, "does not resolve");
    }
    // Names are case-insensitive; TXT content (DKIM keys) is case-sensitive.
    const expected =
      record.type === "MX"
        ? `${record.priority ?? 0} ${normalize(record.content)}`
        : record.type === "TXT"
          ? record.content
          : normalize(record.content);
    const answers = await recordAnswers(ctx, record);
    return answers.includes(expected)
      ? pass(name, `→ ${expected}`)
      : fail(name, `expected ${expected}, got ${answers.join(", ") || "no answer"}`);
  });
}

export async function checkDns(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const serviceHosts = [
    ...publicRailwayServices(ctx.config).map((service) => service.hostname as string),
    ...(ctx.config.aliases ?? []).map((alias) => alias.hostname),
  ];
  const records = Object.values(ctx.config.cloudflare?.dns?.records ?? {});
  const recordNames = new Set(records.map((record) => record.name));
  const proxiedHosts = [...tunnelHostnames(ctx.config), ...redirectHostnames(ctx.config)].filter(
    (hostname) => !recordNames.has(hostname),
  );
  const probes: (() => Promise<CheckResult>)[] = [
    () => nameservers(ctx),
    ...serviceHosts.map((hostname) => () => serviceRecord(ctx, hostname)),
    ...proxiedHosts.map((hostname) => () => proxiedHost(ctx, hostname)),
    ...records.map((record) => () => declaredRecord(ctx, record)),
  ];
  return mapLimit(probes, CONCURRENCY, (probe) => probe());
}
