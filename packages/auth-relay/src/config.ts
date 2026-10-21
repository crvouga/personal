export interface Config {
  origin: string;
  issuer: string;
  upstream: string;
  realm: string;
  schema: string;
  database: string;
  consoleId: string;
  consoleSecret: string;
  managerId: string;
  managerSecret: string;
  setupToken: string;
  environment: 'production' | 'nonproduction';
  developmentIdentity: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw Object.assign(new Error(`Missing required setting: ${name}`), {
      code: 'AUTH_SETTING_MISSING',
      setting: name,
    });
  return value;
}

export function configuration(): Config {
  const origin = new URL(required('AUTH_ORIGIN'));
  if (
    origin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(origin.hostname)
  ) {
    throw new Error('AUTH_ORIGIN must use HTTPS');
  }
  const environment = required('AUTH_ENVIRONMENT');
  if (environment !== 'production' && environment !== 'nonproduction') {
    throw new Error('Invalid AUTH_ENVIRONMENT');
  }
  const realm = required('AUTH_REALM');
  if (!/^[a-zA-Z0-9_-]+$/.test(realm)) throw new Error('Invalid AUTH_REALM');
  return {
    origin: origin.origin,
    issuer: `${origin.origin}/realms/${realm}`,
    upstream: new URL(required('AUTH_UPSTREAM')).origin,
    realm,
    schema: `auth_relay_${environment}`,
    database: required('AUTH_DATABASE_URL'),
    consoleId: required('AUTH_CONSOLE_CLIENT_ID'),
    consoleSecret: required('AUTH_CONSOLE_CLIENT_SECRET'),
    managerId: required('AUTH_MANAGER_CLIENT_ID'),
    managerSecret: required('AUTH_MANAGER_CLIENT_SECRET'),
    setupToken: required('AUTH_SETUP_TOKEN'),
    environment,
    developmentIdentity:
      process.env['AUTH_DEV_MODE'] === 'local' &&
      environment === 'nonproduction' &&
      origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(origin.hostname),
  };
}
