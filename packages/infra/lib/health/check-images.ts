/**
 * Verify images with the pull credentials declared for Railway, or anonymously
 * for public images. Registry passwords are read from production Vault.
 */
import type { ServiceSpec } from "../schema.js";
import { isRailwayService } from "../services.js";
import { asRecord, errorMessage, getJson, mapLimit, type HealthContext } from "./context.js";
import { fail, pass, skip, type CheckResult } from "./report.js";
import { serviceImage } from "./targets.js";

const CONCURRENCY = 6;
const REGISTRY = "ghcr.io";
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export type ImageRef = { readonly registry: string; readonly repository: string; readonly tag: string };

export function parseImageRef(image: string): ImageRef | undefined {
  const match = /^([^/]+)\/([^:@]+)(?::([^@]+))?$/.exec(image);
  if (!match) return undefined;
  return { registry: match[1] as string, repository: match[2] as string, tag: match[3] ?? "latest" };
}

async function checkImage(ctx: HealthContext, service: ServiceSpec): Promise<CheckResult> {
  const image = serviceImage(ctx.config, service);
  const ref = parseImageRef(image);
  if (!ref || ref.registry !== REGISTRY) return skip(service.id, `${image} is not hosted on ${REGISTRY}`);
  try {
    const registry = service.railway?.registry;
    const headers: Record<string, string> = {};
    if (registry) {
      const doc = await ctx.kv("prd");
      if (!doc.ok) return doc.unverifiable ? skip(service.id, doc.reason) : fail(service.id, doc.reason);
      const password = doc.data[registry.vault_key]?.trim();
      if (!password) return fail(service.id, `missing or empty registry credential: ${registry.vault_key}`);
      headers.Authorization = `Basic ${Buffer.from(`${registry.username}:${password}`).toString("base64")}`;
    }
    const grant = await getJson(ctx, `https://${REGISTRY}/token?scope=repository:${ref.repository}:pull`, headers);
    const token = asRecord(grant.body)["token"];
    if (grant.status !== 200 || typeof token !== "string") {
      return fail(service.id, `${image}: no ${registry ? "authenticated" : "anonymous"} pull token (HTTP ${grant.status}); check package access`);
    }
    const res = await ctx.fetch(`https://${REGISTRY}/v2/${ref.repository}/manifests/${ref.tag}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_TYPES },
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    if (res.status === 200) return pass(service.id, `${image} is ${registry ? "pullable with declared registry credentials" : "publicly pullable"}`);
    if (res.status === 404) return fail(service.id, `${image} does not exist; publish the image`);
    return fail(service.id, `${image}: manifest request returned HTTP ${res.status}`);
  } catch (err) {
    return fail(service.id, `${image}: ${errorMessage(err)}`);
  }
}

export async function checkImages(ctx: HealthContext): Promise<readonly CheckResult[]> {
  return mapLimit(ctx.config.services.filter(isRailwayService), CONCURRENCY, (service) => checkImage(ctx, service));
}
