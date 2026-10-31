/** Persistent shims make the same tool commands work in interactive shells and agents. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function appendOnce(path: string, block: string): void {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.includes(block.trim())) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${current}\n${block}\n`);
}

export function miseDataDir(
  platform = process.platform,
  env = process.env,
  home = homedir()
): string {
  const fallback =
    platform === 'win32'
      ? env['LOCALAPPDATA'] || join(home, 'AppData', 'Local')
      : join(home, '.local', 'share');
  return env['MISE_DATA_DIR'] || join(env['XDG_DATA_HOME'] || fallback, 'mise');
}

function persistWindowsPath(bin: string, shims: string): void {
  const script =
    "$paths = @($env:WORKSPACE_TOOL_SHIMS, $env:WORKSPACE_TOOL_BIN); $old = [Environment]::GetEnvironmentVariable('Path', 'User'); $new = (($paths + ($old -split ';') | Where-Object { $_ } | Select-Object -Unique) -join ';'); [Environment]::SetEnvironmentVariable('Path', $new, 'User')";
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        WORKSPACE_TOOL_BIN: bin,
        WORKSPACE_TOOL_SHIMS: shims,
      },
    }
  );
  if (result.status !== 0)
    throw new Error(
      'Could not persist the user PATH. See scripts/dev/README.md.'
    );
}

export function configureShellPath(): void {
  const bin = join(homedir(), '.local', 'bin');
  const shims = process.env['MISE_SHIMS_DIR'] || join(miseDataDir(), 'shims');
  if (process.platform === 'win32') {
    persistWindowsPath(bin, shims);
    return;
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const block = `# crvouga/workspace toolchain\nexport PATH=${quote(`${shims}:${bin}`)}:"$PATH"`;
  for (const name of ['.profile', '.bashrc', '.zshrc'])
    appendOnce(join(homedir(), name), block);
  const fishQuote = (value: string) =>
    `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  appendOnce(
    join(homedir(), '.config/fish/config.fish'),
    `# crvouga/workspace toolchain\nfish_add_path --prepend ${fishQuote(shims)} ${fishQuote(bin)}`
  );
}
