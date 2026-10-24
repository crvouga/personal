import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { apiJson } from './http.ts';
export async function validateSourceIdentity(input: {
  source: SourceConfig;
  token: string;
  fetch: typeof fetch;
}): Promise<void> {
  if (!input.source.identity) throw new ManagerError('invalid-config');
  const expected = input.source.identity.toLowerCase();
  if (input.source.kind === 'gmail') {
    const profile = await apiJson<{ emailAddress: string }>({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      token: input.token,
      origin: 'https://gmail.googleapis.com',
      fetch: input.fetch,
    });
    if (profile.emailAddress.toLowerCase() !== expected)
      throw new ManagerError('conflict');
  } else if (input.source.kind === 'microsoft') {
    const profile = await apiJson<{
      mail?: string;
      userPrincipalName?: string;
    }>({
      url: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      token: input.token,
      origin: 'https://graph.microsoft.com',
      fetch: input.fetch,
    });
    if (
      ![profile.mail, profile.userPrincipalName].some(
        (value) => value?.toLowerCase() === expected
      )
    )
      throw new ManagerError('conflict');
  }
}
