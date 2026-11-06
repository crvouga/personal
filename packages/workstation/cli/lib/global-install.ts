import {
  mkdirSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { GlobalInstallResult, Platform } from './platform/types';

export const PERSONAL_BIN_NAME = 'personal';

/** Install the single source-owned public CLI and retire only our legacy launcher. */
export function installGlobalLauncher(
  workstationRoot: string,
  platform: Platform
): GlobalInstallResult {
  if (platform.name === 'windows')
    throw new Error(
      'Use the npm-installed personal executable on native Windows; source launcher installation requires macOS/Linux/WSL.'
    );
  const binDir = platform.globalBinDir();
  mkdirSync(binDir, { recursive: true });
  const launcherPath = globalLauncherPath(platform);
  const target = resolve(workstationRoot, '../personal-cli/bin.mjs');
  const existed = entryExists(launcherPath);
  if (existed && !ownedPersonalLauncher(launcherPath))
    throw new Error(
      'personal launcher conflicts with an existing installation. Keep the npm installation or move the conflicting file before source installation.'
    );
  if (!existed || readlinkSync(launcherPath) !== target) {
    const temporary = `${launcherPath}.${process.pid}.tmp`;
    symlinkSync(target, temporary, 'file');
    try {
      renameSync(temporary, launcherPath);
    } finally {
      if (entryExists(temporary)) unlinkSync(temporary);
    }
  }
  removeLegacyLauncher(binDir);
  return {
    binDir,
    launcherPath,
    created: !existed,
    alreadyOnPath: isOnPath(binDir),
  };
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function removeLegacyLauncher(binDir: string): void {
  for (const name of ['ws', 'ws.cmd']) {
    const path = join(binDir, name);
    if (!entryExists(path)) continue;
    const info = lstatSync(path);
    const linked =
      info.isSymbolicLink() &&
      /[/\\]workstation[/\\]cli[/\\]bin\.mjs$/.test(readlinkSync(path));
    const owned =
      info.isFile() &&
      info.size < 8192 &&
      /Managed by `ws install`/.test(readFileSync(path, 'utf8'));
    if (linked || owned) unlinkSync(path);
    else
      throw new Error(
        'An unrelated ws executable was preserved. Remove it explicitly if it should no longer be on PATH.'
      );
  }
}

export function globalLauncherPath(platform: Platform): string {
  return join(platform.globalBinDir(), PERSONAL_BIN_NAME);
}

export function isOnPath(
  dir: string,
  pathEnv: string = process.env['PATH'] ?? ''
): boolean {
  const sep = process.platform === 'win32' ? ';' : ':';
  return pathEnv.split(sep).some((entry) => entry === dir);
}

export function pathExportLine(binDir: string, rcFile: string): string {
  if (rcFile.endsWith('config.fish')) return `fish_add_path "${binDir}"`;
  return `export PATH="${binDir}:$PATH"`;
}

export function ownedPersonalLauncher(path: string): boolean {
  if (!entryExists(path) || !lstatSync(path).isSymbolicLink()) return false;
  const target = readlinkSync(path);
  if (!/[/\\]packages[/\\]personal-cli[/\\]bin\.mjs$/.test(target))
    return false;
  try {
    return readFileSync(target, 'utf8').includes('// Source-owned launcher;');
  } catch {
    return false;
  }
}
