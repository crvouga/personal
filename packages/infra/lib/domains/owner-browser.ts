/** Authentication bootstrap only; infrastructure writes remain OpenTofu-owned. */
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const OWNER_DASHBOARD = 'https://account.squarespace.com/domains';

export function ownerBrowserEnvironment(): Record<string, string> {
  return Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', '__CF_USER_TEXT_ENCODING']
    .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
}

/** Keep this browser separate from both the IDE WebView and personal Chrome. */
export function openOwnerBrowser(repoRoot: string): string {
  if (process.platform !== 'darwin') throw new Error('The local owner browser launcher currently requires macOS and Google Chrome');
  const campaign = join(repoRoot, '.domain-migration');
  const profile = join(campaign, 'owner-chrome');
  for (const path of [campaign, profile]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
      throw new Error('Owner browser directories must be owned regular directories, without symlinks');
    }
    chmodSync(path, 0o700);
  }
  // Chrome needs no infrastructure tokens, backend keys or OpenTofu inputs.
  const env = ownerBrowserEnvironment();
  try {
    execFileSync('/usr/bin/open', ['-na', 'Google Chrome', '--args', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--new-window', OWNER_DASHBOARD],
    { env, stdio: 'ignore', timeout: 15000 });
  } catch { throw new Error('Could not open the owner browser; install Google Chrome and rerun bun domains browser'); }
  return profile;
}
