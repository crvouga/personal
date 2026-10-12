/** HTTP health of every hosted service, Cloudflare redirect and tunnel endpoint. */
import { probeHttp, serviceHealthUrl } from "../service-health.js";
import type { CloudflareRedirectSpec, ServiceSpec } from "../schema.js";
import { isAlwaysOn, isRailwayService } from "../services.js";
import { errorMessage, mapLimit, type HealthContext } from "./context.js";
import { fail, pass, skip, warn, type CheckResult } from "./report.js";
import { tunnelHostnames } from "./targets.js";

const CONCURRENCY = 6;
/** Cloudflare's answer when a tunnel has no connected connector. */
const TUNNEL_OFFLINE_STATUS = 530;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A sleeping Railway service needs a cold start, so it gets a longer attempt. */
async function checkService(ctx: HealthContext, service: ServiceSpec): Promise<CheckResult> {
  const url = serviceHealthUrl(service);
  if (!url) return skip(service.id, service.hostname ? "health_check is disabled in the inventory" : "no public hostname");
  const alwaysOn = isAlwaysOn(service);
  const timeoutMs = alwaysOn ? ctx.options.timeoutMs : ctx.options.coldStartTimeoutMs;
  const attempts = ctx.options.retries + 1;
  let lastError = "no attempt made";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    const http = await probeHttp(url, timeoutMs, ctx.fetch);
    if (http.ok) {
      const retried = attempt > 1 ? `, attempt ${attempt}/${attempts}` : "";
      return pass(service.id, `${url} → HTTP ${http.status} (${Date.now() - started}ms${retried})`);
    }
    lastError = http.error ?? `HTTP ${http.status}`;
    if (http.fastFail && alwaysOn) break;
    if (attempt < attempts) await sleep(ctx.options.retryDelayMs);
  }
  return fail(service.id, `${url} → ${lastError}`);
}

async function checkRedirect(ctx: HealthContext, redirect: CloudflareRedirectSpec): Promise<CheckResult> {
  const name = `redirect ${redirect.from}`;
  const target =
    redirect.to ?? ctx.config.services.find((service) => service.id === redirect.to_service)?.hostname;
  if (!target) return fail(name, `target service ${redirect.to_service} has no hostname`);
  const expectedStatus = redirect.status ?? 301;
  const expectedLocation = `https://${target}/`;
  try {
    const res = await ctx.fetch(`https://${redirect.from}/`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    const location = res.headers.get("location") ?? "";
    if (res.status !== expectedStatus) return fail(name, `expected HTTP ${expectedStatus}, got ${res.status}`);
    if (!location.startsWith(expectedLocation)) {
      return fail(name, `expected Location ${expectedLocation}, got ${location || "none"}`);
    }
    return pass(name, `HTTP ${res.status} → ${location}`);
  } catch (err) {
    return fail(name, errorMessage(err));
  }
}

export async function checkServices(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const services = ctx.config.services.filter(isRailwayService);
  const probes: (() => Promise<CheckResult>)[] = [
    ...services.map((service) => () => checkService(ctx, service)),
    ...(ctx.config.cloudflare?.redirects ?? []).map((redirect) => () => checkRedirect(ctx, redirect)),
  ];
  return mapLimit(probes, CONCURRENCY, (probe) => probe());
}

/**
 * Tunnels terminate on a workstation. An offline connector is a degraded state
 * the operator may have chosen, so it warns; an unreachable edge is a failure.
 */
async function checkTunnel(ctx: HealthContext, hostname: string): Promise<CheckResult> {
  try {
    const res = await ctx.fetch(`https://${hostname}/`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    if (res.status === TUNNEL_OFFLINE_STATUS) {
      return warn(hostname, `connector offline (HTTP ${res.status}); start the tunnel on the workstation that serves it`);
    }
    if (res.status >= 500) return warn(hostname, `connector online but the local service answered HTTP ${res.status}`);
    return pass(hostname, `connector online (HTTP ${res.status})`);
  } catch (err) {
    return fail(hostname, `Cloudflare edge unreachable: ${errorMessage(err)}`);
  }
}

export async function checkTunnels(ctx: HealthContext): Promise<readonly CheckResult[]> {
  return mapLimit(tunnelHostnames(ctx.config), CONCURRENCY, (hostname) => checkTunnel(ctx, hostname));
}
