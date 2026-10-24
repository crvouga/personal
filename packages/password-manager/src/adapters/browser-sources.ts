import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { stableId } from '../domain/identity.ts';
export interface BrowserSource {
  id: string;
  browser: string;
  profile: string;
  exportRequired: true;
  instructions: string[];
}
/** Reads profile metadata only, never protected password/cookie databases. */
export function detectBrowserSources(
  platform = process.platform
): BrowserSource[] {
  const home = homedir();
  const base =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : join(home, '.config');
  const paths =
    platform === 'darwin'
      ? [
          ['Chrome', join(base, 'Google', 'Chrome')],
          ['Chromium', join(base, 'Chromium')],
          ['Brave', join(base, 'BraveSoftware', 'Brave-Browser')],
        ]
      : [
          ['Chrome', join(base, 'google-chrome')],
          ['Chromium', join(base, 'chromium')],
          ['Brave', join(base, 'BraveSoftware', 'Brave-Browser')],
        ];
  const sources = paths.flatMap(([browser, directory]) =>
    chromiumProfiles(browser!, directory!)
  );
  const firefox =
    platform === 'darwin'
      ? join(base, 'Firefox')
      : join(home, '.mozilla', 'firefox');
  sources.push(...firefoxProfiles(firefox));
  if (platform === 'darwin')
    sources.push({
      id: 'apple-passwords',
      browser: 'Apple Passwords',
      profile: 'OS account',
      exportRequired: true,
      instructions: [
        '1. Open Passwords, authenticate with Touch ID/system password.',
        '2. File > Export All Passwords; choose a private local CSV destination.',
        '3. Run bun run password-manager sources add apple csv --file /private/export.csv. Passkeys require native exchange/enrollment.',
      ],
    });
  return sources;
}
function chromiumProfiles(browser: string, directory: string): BrowserSource[] {
  const path = join(directory, 'Local State');
  if (!existsSync(path)) return [];
  try {
    const input = JSON.parse(readFileSync(path, 'utf8')) as {
      profile?: { info_cache?: Record<string, unknown> };
    };
    return Object.keys(input.profile?.info_cache ?? {}).map((profile) => ({
      id: stableId(browser, profile),
      browser,
      profile,
      exportRequired: true,
      instructions: [
        `1. Open ${browser} and select profile ${profile}.`,
        '2. Settings > Autofill and passwords > Password Manager > Settings > Export passwords. Complete the OS authentication prompt.',
        '3. Export CSV to a private local directory and run bun run password-manager sources add PROFILE_ID csv --file /private/export.csv.',
      ],
    }));
  } catch {
    return [];
  }
}
function firefoxProfiles(directory: string): BrowserSource[] {
  const path = join(directory, 'profiles.ini');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\[Profile\d+\]/)
    .slice(1)
    .flatMap((section) => {
      const profile = /^Path=(.+)$/m.exec(section)?.[1]?.trim();
      if (!profile) return [];
      return [
        {
          id: stableId('Firefox', resolve(directory, profile)),
          browser: 'Firefox',
          profile,
          exportRequired: true as const,
          instructions: [
            '1. Open Firefox with this profile and visit about:logins.',
            '2. Menu > Export Logins; complete browser/OS authentication and save CSV privately.',
            '3. Run bun run password-manager sources add PROFILE_ID csv --file /private/export.csv.',
          ],
        },
      ];
    });
}
