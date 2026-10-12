/**
 * Railway pulls every image anonymously, so each one must exist and be public.
 * This asks the registry exactly what Railway asks, without credentials.
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
    const grant = await getJson(ctx, `https://${REGISTRY}/token?scope=repository:${ref.repository}:pull`);
    const token = asRecord(grant.body)["token"];
    if (grant.status !== 200 || typeof token !== "string") {
      return fail(service.id, `${image}: no anonymous pull token (HTTP ${grant.status}); the package is missing or private`);
    }
    const res = await ctx.fetch(`https://${REGISTRY}/v2/${ref.repository}/manifests/${ref.tag}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_TYPES },
      signal: AbortSignal.timeout(ctx.options.timeoutMs),
    });
    if (res.status === 200) return pass(service.id, `${image} is publicly pullable`);
    if (res.status === 404) return fail(service.id, `${image} does not exist; publish the image`);
    return fail(service.id, `${image}: manifest request returned HTTP ${res.status}`);
  } catch (err) {
    return fail(service.id, `${image}: ${errorMessage(err)}`);
  }
}

export async function checkImages(ctx: HealthContext): Promise<readonly CheckResult[]> {
  return mapLimit(ctx.config.services.filter(isRailwayService), CONCURRENCY, (service) => checkImage(ctx, service));
}
