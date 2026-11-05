/** Default local T3 Code server origin. */
export const LOCAL_T3_ORIGIN = 'http://127.0.0.1:3773';

export type T3Environment = {
  readonly label: string;
  readonly serverVersion: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `/.well-known/t3/environment`. Pure — unit-tested. */
export function parseT3Environment(body: unknown): T3Environment | null {
  if (!isRecord(body)) return null;
  const version = body['serverVersion'];
  if (typeof version !== 'string' || version.length === 0) return null;
  const label = body['label'];
  return {
    serverVersion: version,
    label: typeof label === 'string' ? label : '',
  };
}

/** Read-only probe of a T3 Code server; `null` when unreachable or not T3. */
export async function fetchT3Environment(
  origin: string,
  timeoutMs = 8000
): Promise<T3Environment | null> {
  try {
    const res = await fetch(`${origin}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parseT3Environment(await res.json());
  } catch {
    return null;
  }
}
