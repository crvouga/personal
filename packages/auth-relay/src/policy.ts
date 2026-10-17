export class RegistrationError extends Error {}

export interface Registration {
  name: string;
  project: string;
  environment: string;
  instance: string;
  callbacks: string[];
  expiresAt: string;
}

export function callbackAllowed(value: string, production: boolean): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.href !== value || forbiddenParts(url) || value.includes('*'))
      return false;
    if (['localhost', '127.0.0.1'].includes(url.hostname)) {
      return !production && url.protocol === 'http:' && !!url.port;
    }
    return secureCallback(url);
  } catch {
    return false;
  }
}

function forbiddenParts(url: URL): boolean {
  return !!(url.username || url.password || url.hash || url.search);
}

function checkedCallbacks(callbacks: unknown, production: boolean): void {
  if (!Array.isArray(callbacks) || callbacks.length < 1 || callbacks.length > 8)
    throw new RegistrationError('Use 1–8 exact callbacks');
  if (
    !callbacks.every(
      (url: unknown) =>
        typeof url === 'string' && callbackAllowed(url, production)
    )
  )
    throw new RegistrationError('Invalid callback');
}

function checkedExpiry(expiresAt: unknown, production: boolean): void {
  const lifetime =
    typeof expiresAt === 'string' ? Date.parse(expiresAt) - Date.now() : NaN;
  const maximum = (production ? 366 : 7) * 86400_000;
  if (!(lifetime > 0 && lifetime <= maximum))
    throw new RegistrationError('Invalid expiry');
}

function label(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,79}$/.test(value)
  );
}

export function registration(
  input: unknown,
  production: boolean
): Registration {
  if (!input || typeof input !== 'object')
    throw new RegistrationError('Invalid registration');
  const data = input as Record<string, unknown>;
  if (![data['name'], data['project'], data['instance']].every(label))
    throw new RegistrationError('Invalid identity');
  const environment = data['environment'];
  const environments = production
    ? ['production']
    : ['staging', 'development', 'localhost', 'preview', 'ci'];
  if (typeof environment !== 'string' || !environments.includes(environment))
    throw new RegistrationError('Wrong environment');
  checkedCallbacks(data['callbacks'], production);
  checkedExpiry(data['expiresAt'], production);
  return {
    name: data['name'] as string,
    project: data['project'] as string,
    instance: data['instance'] as string,
    environment,
    callbacks: data['callbacks'] as string[],
    expiresAt: data['expiresAt'] as string,
  };
}

function secureCallback(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname.includes('.') &&
    !url.hostname.endsWith('.localhost')
  );
}
