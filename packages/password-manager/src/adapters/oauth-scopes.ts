import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
export function assertMailScopes(
  source: SourceConfig,
  granted: string[]
): void {
  if (!Array.isArray(granted)) throw new ManagerError('insufficient-scope');
  const normalize = (scope: string) => scope.split('/').pop()!.toLowerCase();
  const scopes = new Set(granted.map(normalize));
  const required =
    source.kind === 'gmail'
      ? ['gmail.readonly']
      : ['mail.readbasic', 'user.read'];
  if (required.some((scope) => !scopes.has(scope)))
    throw new ManagerError('insufficient-scope');
}
