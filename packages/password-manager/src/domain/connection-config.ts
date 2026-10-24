import { parseConfig, type Config, type SourceConfig } from './config.ts';
import { ManagerError } from './errors.ts';
export function bindBitwarden(
  current: Config,
  options: { email?: string; server?: string }
): Config {
  const configured = current.bitwarden;
  if (!options.email && !configured) throw new ManagerError('invalid-config');
  const config = parseConfig({
    ...current,
    sources: current.sources.some((s) => s.kind === 'bitwarden')
      ? current.sources
      : [...current.sources, { id: 'bitwarden', kind: 'bitwarden' }],
    bitwarden: {
      ...configured,
      email: options.email ?? configured?.email,
      server: selectedServer(current, options.server),
    },
  });
  if (
    configured &&
    JSON.stringify(configured) !== JSON.stringify(config.bitwarden)
  )
    throw new ManagerError('conflict');
  return config;
}
export function upsertSource(current: Config, source: SourceConfig): Config {
  return parseConfig({
    ...current,
    sources: [...current.sources.filter((s) => s.id !== source.id), source],
  });
}

function selectedServer(current: Config, server: string | undefined): string {
  return server ?? current.bitwarden?.server ?? 'https://vault.bitwarden.com';
}
