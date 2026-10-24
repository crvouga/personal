import { RegistrationError, registration, type Registration } from './policy';

export interface AgentGrant {
  tokenHash: string;
  project: string;
  environments: string[];
  origins: string[];
  allowLoopback: boolean;
  expiresAt: string;
}

export function agentGrant(input: unknown, production: boolean): AgentGrant {
  if (!input || typeof input !== 'object')
    throw new RegistrationError('Invalid agent grant');
  const data = input as AgentGrant;
  if (
    typeof data.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.tokenHash)
  )
    throw new RegistrationError(
      'Supply the SHA-256 fingerprint, never the credential'
    );
  checkScope(data, production);
  // Reuse the supported environments, identity and lease bounds.
  for (const environment of data.environments)
    registration(
      {
        name: data.project,
        project: data.project,
        instance: 'grant',
        environment,
        callbacks: ['https://validation.example/callback'],
        expiresAt: data.expiresAt,
      },
      production
    );
  return {
    tokenHash: data.tokenHash,
    project: data.project,
    environments: [...new Set(data.environments)],
    origins: [...new Set(data.origins)],
    allowLoopback: data.allowLoopback,
    expiresAt: data.expiresAt,
  };
}

function exactOrigin(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      value === url.origin &&
      url.protocol === 'https:' &&
      !url.hostname.includes('*') &&
      url.hostname.includes('.') &&
      !url.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

export function authorizeRegistration(
  grant: AgentGrant,
  input: Registration
): void {
  if (
    input.project !== grant.project ||
    !grant.environments.includes(input.environment) ||
    Date.parse(input.expiresAt) > Date.parse(grant.expiresAt)
  )
    throw new RegistrationError(
      'Registration exceeds the delegated project, environment or expiry'
    );
  for (const callback of input.callbacks) {
    const url = new URL(callback);
    const loopback =
      grant.allowLoopback &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      !!url.port;
    if (!loopback && !grant.origins.includes(url.origin))
      throw new RegistrationError(
        'Callback origin is outside the delegated scope'
      );
  }
}

export function clientId(value: string): boolean {
  return /^app-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    value
  );
}

function checkScope(data: AgentGrant, production: boolean): void {
  if (
    !Array.isArray(data.environments) ||
    !data.environments.length ||
    data.environments.length > 5
  )
    throw new RegistrationError('Select allowed environments');
  if (
    !Array.isArray(data.origins) ||
    data.origins.length > 16 ||
    !data.origins.every(exactOrigin)
  )
    throw new RegistrationError(
      'Use exact HTTPS origins without paths or wildcards'
    );
  checkLoopback(data, production);
}
function checkLoopback(data: AgentGrant, production: boolean): void {
  if (
    typeof data.allowLoopback !== 'boolean' ||
    (production && data.allowLoopback)
  )
    throw new RegistrationError('Loopback delegation is nonproduction only');
  if (!data.origins.length && !data.allowLoopback)
    throw new RegistrationError('Approve an origin or loopback development');
}
