export type Command = (
  args: string[],
  env: Record<string, string>
) => Promise<string>;

/** Capture both streams: provider diagnostics can contain submitted credentials. */
export const command: Command = async (args, env) => {
  const child = Bun.spawn(args, {
    env: {
      ...process.env,
      ...env,
      TF_IN_AUTOMATION: '1',
      TF_LOG: 'OFF',
      TF_LOG_CORE: 'OFF',
      TF_LOG_PROVIDER: 'OFF',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    signal: cancellation.signal,
  });
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    const operation = args.includes('state')
      ? 'state list'
      : (args.find((arg) => ['init', 'show', 'plan', 'apply'].includes(arg)) ??
        args[0]);
    throw new Error(
      `${args[0]} ${operation} failed (exit ${code}). Check state access, credentials and provider connectivity. Raw provider output is hidden because it may contain secrets.`
    );
  }
  return stdout.trim();
};
import { cancellation } from './cancel';
