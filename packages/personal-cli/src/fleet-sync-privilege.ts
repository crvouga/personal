import { spawn } from 'node:child_process';
import type { Check, FleetNode, Runner } from '../../fleet/src/types';
import { shellQuote, sshArgs, sshFailure } from '../../fleet/src/ssh';

/** Password entry belongs exclusively to native sudo over the user's terminal.
 * No password, environment or auth output is read by the CLI or its report.
 */
export async function authorizePrivilege(
  node: FleetNode,
  script: string | undefined,
  run: Runner
): Promise<Check[]> {
  const existing = await run([...sshArgs(node), 'sudo -n true'], {
    timeoutMs: 15_000,
  });
  if (existing.ok) return [];
  if (existing.reason !== 'exit' || !/sudo:/i.test(existing.stderr))
    return [sshFailure(existing)];
  if (!script || !process.stdin.isTTY || !process.stderr.isTTY)
    return required();
  process.stderr.write(
    `[${node.id}] Native sudo authorization is needed to install the declared designated-user sudo policy.\n`
  );
  const args = sshArgs(node)
    .slice(1)
    .filter((arg) => arg !== '-T');
  args.unshift('-tt');
  const ok = await terminalSudo([...args, `sh -c ${shellQuote(script)}`]);
  if (!ok) return required();
  const verified = await run([...sshArgs(node), 'sudo -n true'], {
    timeoutMs: 15_000,
  });
  return verified.ok ? [] : required();
}
function terminalSudo(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ssh', args, { stdio: 'inherit' });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
      child.kill('SIGTERM');
      escalation = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, 5_000);
    }, 300_000);
    child.on('error', () => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      resolve(code === 0);
    });
  });
}
function required(): Check[] {
  return [
    {
      id: 'bootstrap:privilege',
      status: 'fail',
      summary: 'SUDO_AUTHORIZATION_REQUIRED',
      remedy: {
        action:
          'Run the approved controller flow from an interactive terminal with a user authorized for sudo. Native sudo reads the password directly; no credential is stored. A user lacking administrator permission requires the existing administrator.',
      },
    },
  ];
}
