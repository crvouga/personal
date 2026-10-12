/** Every public hostname presents a trusted certificate that is not about to expire. */
import { errorMessage, mapLimit, type HealthContext } from "./context.js";
import { fail, pass, warn, type CheckResult } from "./report.js";
import { httpsHostnames } from "./targets.js";

const CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

async function checkCertificate(ctx: HealthContext, hostname: string): Promise<CheckResult> {
  try {
    const cert = await ctx.certificate(hostname);
    const daysLeft = Math.floor((cert.validTo.getTime() - ctx.now().getTime()) / DAY_MS);
    const expiry = cert.validTo.toISOString().slice(0, 10);
    if (daysLeft < 0) return fail(hostname, `certificate expired ${expiry}`);
    if (!cert.authorized) return fail(hostname, `certificate not trusted: ${cert.error ?? "unknown reason"}`);
    if (daysLeft < ctx.options.certificateWarnDays) {
      return warn(hostname, `certificate expires in ${daysLeft} day(s) (${expiry}); renewal has not happened`);
    }
    return pass(hostname, `valid until ${expiry} (${daysLeft} days)`);
  } catch (err) {
    return fail(hostname, `TLS handshake failed: ${errorMessage(err)}`);
  }
}

export async function checkTls(ctx: HealthContext): Promise<readonly CheckResult[]> {
  return mapLimit(httpsHostnames(ctx.config), CONCURRENCY, (hostname) => checkCertificate(ctx, hostname));
}
