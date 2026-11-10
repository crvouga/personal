/** Minimal `gh` CLI wrapper for CI scripts. GH_TOKEN and GITHUB_REPOSITORY come from the workflow. */

export function gh(args: string[], input?: string): string {
  const result = Bun.spawnSync(['gh', ...args], {
    stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw new Error(
      `gh ${args.slice(0, 3).join(' ')} failed: ${result.stderr.toString().trim()}`
    );
  return result.stdout.toString();
}

export function ghJson<T>(args: string[]): T {
  return JSON.parse(gh(args)) as T;
}

export function repository(): string {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  return repo;
}

export function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}
