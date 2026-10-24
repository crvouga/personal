import { statSync } from 'node:fs';
import type { SecretStore } from '@pkgs/secret-store';
import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { assertMailScopes } from '../adapters/oauth-scopes.ts';
import { apiJson } from '../adapters/http.ts';
import { validateSourceIdentity } from '../adapters/source-identity.ts';
import type { DoctorProbes } from './doctor-probes.ts';
export async function checkSource(input: {
  source: SourceConfig;
  secrets: SecretStore;
  probes: DoctorProbes;
}): Promise<void> {
  const { source, probes } = input;
  if (!source.enabled || source.kind === 'bitwarden') return;
  if (!['gmail', 'microsoft', 'imap'].includes(source.kind)) {
    if (!source.path || !statSync(source.path).isFile())
      throw new ManagerError('missing');
    return;
  }
  if (source.kind === 'imap') {
    const { probeImap } = await import('../adapters/imap.ts');
    await probeImap(source, {
      secrets: input.secrets,
      fetch: probes.fetch,
      vault: null,
      runtime: {
        now: () => new Date(probes.now()).toISOString(),
        id: () => 'doctor',
        password: () => {
          throw new ManagerError('invalid-input');
        },
      },
    });
    return;
  }
  if (!source.tokenRef) throw new ManagerError('not-authenticated');
  const token = JSON.parse(
    (await input.secrets.getRequired(source.tokenRef)).readSecretValue()
  ) as { accessToken: string; expiresAt: number; scopes: string[] };
  if (token.expiresAt <= probes.now())
    throw new ManagerError('expired-connection');
  assertMailScopes(source, token.scopes);
  await validateSourceIdentity({
    source,
    token: token.accessToken,
    fetch: probes.fetch,
  });
  const url =
    source.kind === 'gmail'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=after%3A2000%2F01%2F01'
      : 'https://graph.microsoft.com/v1.0/me/messages?$select=id&$top=1';
  await apiJson<unknown>({
    url,
    token: token.accessToken,
    origin: new URL(url).origin,
    fetch: probes.fetch,
  });
}
