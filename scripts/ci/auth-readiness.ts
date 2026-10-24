/** Read-only admin readiness. Preserve rollout stability; overlap independent instances. */
import { readFileSync } from 'node:fs';

export type AdminEndpoint = {
  url: string;
  access_client_id: string;
  access_client_secret: string;
};
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
type ProbeOptions = Partial<Clock> & {
  fetch?: (url: string, options: RequestInit) => Promise<Response>;
  report?: (message: string) => void;
};

export function stableWindow(
  changes: string | undefined,
  firstDeployment: boolean,
  foundationChanges?: string
): number {
  if (firstDeployment || !changes || !foundationChanges) return 240_000;
  try {
    const upstream: unknown = JSON.parse(foundationChanges);
    if (!Array.isArray(upstream) || upstream.length) return 240_000;
    const addresses: unknown = JSON.parse(changes);
    // Only proven gateway-only/no-op plans can avoid identity rollout waiting.
    if (
      Array.isArray(addresses) &&
      addresses.every(
        (address) =>
          typeof address === 'string' && address.startsWith('module.broker[')
      )
    )
      return 0;
  } catch {
    /* Missing or unrecognized plan metadata uses the full stability gate. */
  }
  return 240_000;
}

export async function waitForEndpoint(
  name: string,
  endpoint: AdminEndpoint,
  stableMs: number,
  options: ProbeOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const request = options.fetch ?? fetch;
  const report = options.report ?? console.log;
  const deadline = now() + 1_200_000;
  let since: number | undefined;
  report(
    `${name}: checking admin API (required stability ${stableMs / 1000}s)`
  );
  for (let attempt = 1; attempt <= 120 && now() < deadline; attempt++) {
    let status = 0;
    try {
      const response = await request(
        `${endpoint.url.replace(/\/$/, '')}/realms/master/.well-known/openid-configuration`,
        {
          headers: {
            'CF-Access-Client-Id': endpoint.access_client_id,
            'CF-Access-Client-Secret': endpoint.access_client_secret,
          },
          signal: AbortSignal.timeout(15_000),
        }
      );
      status = response.status;
      await response.body?.cancel();
    } catch {
      /* Report only status, never request headers or OAuth response data. */
    }
    if (status === 200) {
      since ??= now();
      if (now() - since >= stableMs) {
        report(`${name}: admin API readiness passed`);
        return;
      }
    } else {
      since = undefined;
      report(
        `${name}: admin API not ready (HTTP ${status || '000'}), attempt ${attempt}/120`
      );
    }
    await sleep(10_000);
  }
  throw new Error(`${name}: admin API did not satisfy its readiness window`);
}

export async function waitForInstances(
  entries: Record<string, AdminEndpoint>,
  stableMs: number,
  probe = waitForEndpoint
): Promise<void> {
  const results = await Promise.allSettled(
    Object.entries(entries).map(([name, endpoint]) =>
      probe(name, endpoint, stableMs)
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Auth admin readiness failed'
    );
}

function endpoint(value: unknown): value is AdminEndpoint {
  if (!value || typeof value !== 'object') return false;
  return ['url', 'access_client_id', 'access_client_secret'].every(
    (key) =>
      key in value &&
      typeof Reflect.get(value, key) === 'string' &&
      Reflect.get(value, key).length > 0
  );
}

if (import.meta.main) {
  const data: unknown = JSON.parse(
    readFileSync('/tmp/auth-admin.json', 'utf8')
  );
  if (!data || typeof data !== 'object')
    throw new Error('Missing auth admin endpoints');
  const names = process.env.ADMIN_INSTANCES?.split(/\s+/).filter(Boolean) ?? [];
  if (!names.length) throw new Error('No auth instances selected');
  const entries: Record<string, AdminEndpoint> = {};
  for (const name of names) {
    const value: unknown = Reflect.get(data, name);
    if (!endpoint(value)) throw new Error(`Missing admin endpoint for ${name}`);
    entries[name] = value;
  }
  await waitForInstances(
    entries,
    stableWindow(
      process.env.AUTH_HOSTING_CHANGES,
      process.env.AUTH_FIRST_DEPLOYMENT !== 'false',
      process.env.AUTH_FOUNDATION_CHANGES
    )
  );
}
