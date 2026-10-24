import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ManagerError } from '../domain/errors.ts';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export function stateDirectory(platform = process.platform): string {
  const home = homedir();
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'password-manager');
  if (platform === 'linux')
    return join(home, '.local', 'state', 'password-manager');
  throw new ManagerError('unsupported-platform');
}
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  );
}
export function assertPrivateLocation(path: string): string {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..');
  const canonical = resolve(
    realpathSync(ancestor),
    relative(ancestor, absolute)
  );
  if (within(realpathSync(repoRoot), canonical))
    throw new ManagerError('unsafe-path');
  if (
    /[/\\](Dropbox|OneDrive|iCloud Drive|CloudStorage|Mobile Documents|Google Drive)([/\\]|$)/i.test(
      canonical
    )
  ) {
    throw new ManagerError('unsafe-path');
  }
  return canonical;
}
export function ensurePrivateDirectory(path: string): void {
  const canonical = assertPrivateLocation(path);
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new ManagerError('unsafe-path');
  mkdirSync(canonical, { recursive: true, mode: 0o700 });
  checkPrivateDirectory(canonical);
}
export function checkPrivateDirectory(path: string): void {
  assertPrivateLocation(path);
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new ManagerError('unsafe-path');
  }
  if (process.getuid && stat.uid !== process.getuid())
    throw new ManagerError('unsafe-path');
}
export function checkPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new ManagerError('unsafe-path');
  }
  if (process.getuid && statSync(path).uid !== process.getuid())
    throw new ManagerError('unsafe-path');
}
