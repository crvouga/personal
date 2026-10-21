import type { Config } from './config';
import type { Registration } from './policy';
import { providerRequest } from './upstream';

export class Manager {
  constructor(private readonly config: Config) {}

  private async token(): Promise<string> {
    const response = await providerRequest(
      this.config,
      'manager.token',
      `${this.config.upstream}/realms/${this.config.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.managerId,
          client_secret: this.config.managerSecret,
        }),
      }
    );
    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  async apply(
    id: string,
    registration: Registration | null,
    overlap: string[]
  ): Promise<void> {
    const headers = {
      Authorization: `Bearer ${await this.token()}`,
      'Content-Type': 'application/json',
    };
    const base = `${this.config.upstream}/admin/realms/${this.config.realm}/clients`;
    const response = await providerRequest(
      this.config,
      'manager.lookup',
      `${base}?clientId=${encodeURIComponent(id)}`,
      {
        headers,
      }
    );
    const clients = (await response.json()) as {
      id: string;
      attributes?: Record<string, string>;
    }[];
    const existing = clients[0];
    if (existing) verifyOwner(existing.attributes, id);
    const attributes = {
      'auth-relay.owner': id,
      'pkce.code.challenge.method': 'S256',
      'use.refresh.tokens': 'false',
    };
    const callbacks = registration
      ? [...new Set([...registration.callbacks, ...overlap])]
      : [];
    await providerRequest(
      this.config,
      'manager.update',
      existing ? `${base}/${existing.id}` : base,
      {
        method: existing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({
          clientId: id,
          name: registration?.name ?? id,
          enabled: !!registration,
          protocol: 'openid-connect',
          publicClient: true,
          standardFlowEnabled: true,
          implicitFlowEnabled: false,
          directAccessGrantsEnabled: false,
          serviceAccountsEnabled: false,
          attributes,
          redirectUris: callbacks,
          webOrigins: [...new Set(callbacks.map((url) => new URL(url).origin))],
        }),
      }
    );
  }
}

function verifyOwner(
  attributes: Record<string, string> | undefined,
  id: string
): void {
  if (attributes?.['auth-relay.owner'] !== id)
    throw new Error('Registration ownership mismatch');
}
