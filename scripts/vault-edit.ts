import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { demoSession } from './secrets/demo';
import { editSecrets } from './secrets/flow';
import { TofuSession } from './secrets/session';
import { ui } from './secrets/ui';
import type { Inventory } from './secrets/types';
import { cancel, cancellation } from './secrets/cancel';

const help = `Usage: bun run vault:edit [--google] [--dry-run] [--demo]

  --google   Go directly to the Google client ID / secret editor
  --dry-run  Review saved OpenTofu plans without applying them
  --demo     Explore the interface with synthetic data; never connects to services
  --help     Show this help

Requires: interactive terminal, Bun, OpenTofu 1.13.0 and an administrator Vault CLI login.
State and provider credentials load automatically from admin-only Vault data.
New values are hidden. Only selected, registered operator inputs can be changed.
Every live apply requires approval of its saved plan. Ctrl+C cancels.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help);
    return;
  }
  if (args.some((arg) => !['--google', '--dry-run', '--demo'].includes(arg)))
    throw new Error('Unknown option. Run bun run vault:edit --help.');
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Open an interactive terminal and run bun run vault:edit.');
  const inventory = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../packages/infra/tofu/modules/inventory/inventory.tf.json'
      ),
      'utf8'
    )
  ).locals.inventory as Inventory;
  console.log(chalk.bold.cyan('\n  Vault · Secret editor'));
  console.log(chalk.dim('  Select → enter → review → apply\n'));
  const demo = args.includes('--demo');
  if (demo)
    console.log(
      chalk.yellow('  DEMO · Synthetic data only. No live changes.\n')
    );
  const session = demo
    ? demoSession(ui, inventory)
    : new TofuSession(inventory, ui);
  try {
    await editSecrets(ui, session, inventory, {
      google: args.includes('--google'),
      dryRun: args.includes('--dry-run'),
    });
  } finally {
    session.close();
  }
}

process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
main()
  .catch((error: unknown) => {
    if (
      cancellation.signal.aborted ||
      (error instanceof Error && error.name === 'ExitPromptError')
    ) {
      console.log(
        chalk.dim('\nCancelled. Any completed applies remain in place.')
      );
      process.exitCode = 130;
      return;
    }
    // Only our own controlled errors reach this boundary; command output is captured.
    console.error(
      chalk.red(
        `\n✗ ${error instanceof Error ? error.message : 'Secret editor failed.'}`
      )
    );
    process.exitCode = 1;
  })
  .finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    // Bun's inherited stdin can remain referenced after a captured Vault read.
    // Release it so setup errors return to the shell instead of leaving it open.
    process.stdin.pause();
    // This is the CLI entry point: all work and child processes have completed.
    // Ora/Inquirer can retain a terminal handle on Bun even after pausing stdin.
    process.exit(process.exitCode ?? 0);
  });
