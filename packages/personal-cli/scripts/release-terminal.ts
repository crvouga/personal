import { ReleaseError } from './release-error';

/** Capture publisher settings while keeping npm's browser/2FA prompts attached to a real PTY. */
export async function terminalOutput(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  display: (data: Uint8Array) => void = (data) => {
    process.stdout.write(data);
  }
): Promise<string> {
  const decoder = new TextDecoder();
  let output = '';
  let overflow = false;
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    terminal: {
      cols: 120,
      rows: 30,
      data(terminal, data) {
        output += decoder.decode(data, { stream: true });
        if (output.length > 1_048_576) {
          overflow = true;
          terminal.close();
          return;
        }
        display(data);
      },
    },
  });
  const input = (data: Buffer) => {
    child.terminal?.write(data);
  };
  process.stdin.on('data', input);
  const timeout = setTimeout(() => child.kill(), 300_000);
  try {
    const code = await child.exited;
    output += decoder.decode();
    if (code !== 0 || overflow)
      throw new ReleaseError(
        'npm publisher verification did not complete. Review the terminal approval or error above; no publisher verification is claimed.'
      );
    return output;
  } finally {
    clearTimeout(timeout);
    process.stdin.off('data', input);
    process.stdin.pause();
    child.terminal?.close();
  }
}

export function terminalPublisherConfigurations(output: string): unknown[] {
  const configurations: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | undefined;
  for (const line of output.replaceAll('\r', '').split('\n')) {
    const field =
      /^(type|id|repository|file|environment|permissions): (.+)$/.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'type') {
      current = {};
      configurations.push(current);
    }
    if (current)
      current[key!] =
        key === 'permissions'
          ? value!
              .split(', ')
              .map((permission) =>
                permission === 'publish' ? 'createPackage' : permission
              )
          : value;
  }
  if (
    !configurations.length &&
    !output.includes('No trust configurations found')
  )
    throw new ReleaseError(
      'npm returned no publisher configuration; verification is unconfirmed.'
    );
  return configurations;
}
