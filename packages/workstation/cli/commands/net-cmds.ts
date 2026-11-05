import type { Command } from 'commander';

import type { GlobalOpts } from '../lib/cli-opts';
import { confirmOrThrow } from '../lib/cli-opts';
import { doctorSummary } from '../lib/doctor';
import { runNetChecks } from '../lib/net/check';
import {
  fixCodeCli,
  fixSshConfig,
  fixTailscaleCli,
  fixVscodeSettings,
  fixWatch,
  NET_JOB_LABEL,
  newBackupDir,
  type FixStep,
} from '../lib/net/fix';
import {
  netStateDir,
  notificationFor,
  readPreviousFailures,
  recordRun,
} from '../lib/net/history';
import {
  inventoryPath,
  loadInventory,
  type NetCheck,
} from '../lib/net/inventory';
import {
  err,
  muted,
  ok,
  printJson,
  resolveOutputMode,
  section,
  warn as warnColor,
} from '../lib/output-and-theme';
import { currentPlatform } from '../lib/platform/index';

type CheckOpts = GlobalOpts & {
  host?: string | undefined;
  tries?: string | undefined;
  notify?: boolean | undefined;
  quiet?: boolean | undefined;
};

function mark(severity: NetCheck['severity']): string {
  if (severity === 'pass') return ok('✓');
  if (severity === 'warn') return warnColor('!');
  return err('✗');
}

function printChecks(checks: readonly NetCheck[], quiet: boolean): void {
  let group = '';
  for (const c of checks) {
    if (quiet && c.severity === 'pass') continue;
    if (c.group !== group) {
      group = c.group;
      section(group);
    }
    console.log(`  ${mark(c.severity)} ${c.label}: ${c.detail}`);
    if (c.fix !== undefined && c.severity !== 'pass') {
      console.log(`      ${muted(`fix: ${c.fix}`)}`);
    }
  }
}

function parseTries(raw: string | undefined): number {
  const n = Number(raw ?? '3');
  if (!Number.isInteger(n) || n < 1 || n > 10)
    throw new Error('--tries must be 1-10');
  return n;
}

export async function cmdNetCheck(opts: CheckOpts): Promise<void> {
  const platform = currentPlatform();
  const checks = await runNetChecks(platform, {
    host: opts.host,
    tries: parseTries(opts.tries),
  });
  const summary = doctorSummary(checks);
  if (opts.notify === true) {
    const note = notificationFor(readPreviousFailures(platform), checks);
    if (note !== null) await platform.postNotification(note);
  }
  recordRun(platform, checks);
  if (resolveOutputMode(opts.json) === 'json') {
    printJson({ ok: summary.fail === 0, checks, summary });
  } else {
    printChecks(checks, opts.quiet === true);
    console.log(
      `\n${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail`
    );
  }
  if (summary.fail > 0) process.exitCode = 1;
}

function printSteps(steps: readonly FixStep[]): void {
  for (const s of steps) {
    const m = !s.ok ? err('✗') : s.changed ? ok('✓') : muted('·');
    console.log(`  ${m} ${s.label}: ${muted(s.detail)}`);
  }
}

export async function cmdNetFix(opts: GlobalOpts): Promise<void> {
  const platform = currentPlatform();
  const hosts = loadInventory();
  await confirmOrThrow(
    'Apply ws net fixes on this machine?',
    `Writes a managed block in ~/.ssh/config, VS Code Remote-SSH settings, CLI wrappers in ${platform.globalBinDir()} and a background check. Files are backed up first.`,
    opts
  );
  const backupDir = newBackupDir(platform);
  const steps = [
    fixTailscaleCli(platform),
    fixCodeCli(platform),
    fixSshConfig(hosts, backupDir),
    fixVscodeSettings(platform, hosts, backupDir),
    fixWatch(platform),
  ];
  if (resolveOutputMode(opts.json) === 'json') {
    printJson({ ok: steps.every((s) => s.ok), steps, backupDir });
  } else {
    section('ws net fix', `backups: ${backupDir}`);
    printSteps(steps);
    console.log(muted('\nNext: ws net check'));
  }
  if (!steps.every((s) => s.ok)) process.exitCode = 1;
}

function cmdNetWatch(
  action: 'install' | 'remove' | 'status',
  opts: GlobalOpts
): void {
  const platform = currentPlatform();
  const result =
    action === 'install'
      ? fixWatch(platform)
      : action === 'remove'
        ? { ...platform.removeScheduledJob(NET_JOB_LABEL), label: 'remove' }
        : {
            ok: true,
            ...platform.scheduledJobStatus(NET_JOB_LABEL),
            label: 'status',
          };
  if (resolveOutputMode(opts.json) === 'json') {
    printJson({
      ...result,
      label: NET_JOB_LABEL,
      logDir: netStateDir(platform),
    });
    return;
  }
  console.log(
    `${result.ok ? ok('✓') : err('✗')} ${NET_JOB_LABEL}: ${result.detail}`
  );
  console.log(muted(`history: ${netStateDir(platform)}/check.log`));
  if (!result.ok) process.exitCode = 1;
}

export function registerNet(program: Command, globals: () => GlobalOpts): void {
  const net = program
    .command('net')
    .description(
      `[net] Tailscale, SSH, T3 Code and VS Code Remote-SSH across machines (${inventoryPath()})`
    );
  net
    .command('check')
    .description('[net] Read-only check of every machine in net/hosts.json')
    .option('--host <alias>', 'Check one host')
    .option(
      '--tries <n>',
      'SSH logins per host, to catch flaky connections',
      '3'
    )
    .option('--notify', 'Desktop notification when failures change')
    .option('--quiet', 'Only print problems')
    .action(async (opts: CheckOpts) => cmdNetCheck({ ...globals(), ...opts }));
  net
    .command('fix')
    .description(
      '[net] Converge this machine: ssh config, VS Code settings, CLIs, watcher'
    )
    .action(async () => cmdNetFix(globals()));
  const watch = net
    .command('watch')
    .description('[net] Background check every 5 minutes');
  for (const action of ['install', 'remove', 'status'] as const) {
    watch
      .command(action)
      .description(`[net] ${action} the background check`)
      .action(() => cmdNetWatch(action, globals()));
  }
}
