export interface Session {
  csrf: string;
  operator: boolean;
  setup: boolean;
  issuer: string;
  environment: string;
  subject: string;
}

export interface Registration {
  name: string;
  project: string;
  environment: string;
  instance: string;
  callbacks: string[];
  expiresAt: string;
}

export interface Client {
  id: string;
  revision: number;
  desired: Registration;
  config: Registration | null;
  revoked: boolean;
  expires_at: string;
}

export function clientStatus(client: Client) {
  if (client.revoked) return 'Revoked';
  if (!client.config) return 'Pending';
  if (new Date(client.expires_at).getTime() <= Date.now()) return 'Expired';
  return 'Active';
}

export const statusColors = {
  Active: 'teal',
  Pending: 'yellow',
  Revoked: 'gray',
  Expired: 'orange',
};

export function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function connectionSettings(
  issuer: string,
  id: string,
  callback: string
) {
  return `OIDC_ISSUER=${issuer}\nOIDC_CLIENT_ID=${id}\nOIDC_REDIRECT_URI=${callback}\nOIDC_SCOPES=openid email profile`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Request failed. Please try again.';
}
