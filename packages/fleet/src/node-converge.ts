import { runLockedCommand as runCommand } from './runner';
import { isRevision } from './machine/state';
import { convergeLinux } from './node-converge-linux';
import { convergeDarwin } from './node-converge-darwin';
import type { Check } from './types';

/** Internal remote entry only. Controller owns the operation lock and source
 * selection; this installs no pull daemon or timer. Never prints child output.
 * Linux is the accepted worker platform; macOS follows the same phases best effort.
 */
async function main(): Promise<Check[]> {
  const [node, revision] = process.argv.slice(2);
  if (!node || !/^[a-z][a-z0-9-]{0,62}$/.test(node) || !isRevision(revision))
    throw new Error();
  const root = process.cwd();
  const head = await runCommand(['git', 'rev-parse', 'HEAD']);
  if (!head.ok || head.stdout.trim() !== revision) throw new Error();
  if (process.platform === 'darwin')
    return convergeDarwin(root, node, revision, runCommand);
  if (process.platform === 'linux')
    return convergeLinux(root, node, revision, runCommand);
  return [
    {
      id: 'platform:unsupported',
      status: 'fail',
      summary: 'PLATFORM_UNSUPPORTED',
      remedy: {
        action: 'Controller convergence supports Ubuntu 26.04 and macOS 14+.',
      },
    },
  ];
}
if (import.meta.main) {
  const checks = await main().catch((): Check[] => [
    {
      id: 'configuration:operation',
      status: 'fail',
      summary: 'REMOTE_CONFIGURATION_INCOMPLETE',
    },
  ]);
  process.stdout.write(JSON.stringify({ version: 1, checks }));
}
