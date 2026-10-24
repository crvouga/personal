import type { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { registerRestore } from './restore.ts';
import { createBackup, verifyBackup } from '../application/backup.ts';
import { schedule } from '../adapters/schedule.ts';
import { cleanupExport } from '../application/export-cleanup.ts';
import { cleanup } from '../application/cleanup.ts';
import { updateConfig } from '../adapters/config-file.ts';
import { action, unlocked, workflow, type AppContext } from './context.ts';
export function registerMaintenance(program: Command): void {
  const backup = program.command('backup');
  registerRestore(program, backup);
  backup.command('create').action(
    action(program, (app) =>
      unlocked(app, () =>
        createBackup({
          context: workflow(app),
          config: app.config,
          directory: app.directory,
        })
      )
    )
  );
  backup.command('verify <id>').action(async (id: string) =>
    action(program, (app) =>
      verifyBackup({
        context: app,
        config: app.config,
        directory: app.directory,
        id,
      })
    )()
  );
  const schedules = program.command('schedule');
  for (const subcommand of ['install', 'status', 'remove'] as const) {
    schedules.command(subcommand).action(
      action(program, (app) =>
        schedule({
          action: subcommand,
          directory: app.directory,
          hour: app.config.scheduleHour,
          cli: fileURLToPath(new URL('../../bin.mjs', import.meta.url)),
        })
      )
    );
  }
  const clean = program
    .command('cleanup')
    .option('--apply', 'Purge expired staging only for completed operations');
  clean
    .command('export <source-id>')
    .option('--apply', 'Delete only this verified source export')
    .action(async (id: string, options: { apply?: boolean }) =>
      action(program, (app) =>
        cleanupSelectedExport(app, id, Boolean(options.apply))
      )()
    );
  clean.action(
    action(program, (app) =>
      cleanup({
        ...app,
        apply: Boolean(clean.opts<{ apply?: boolean }>().apply),
      })
    )
  );
  program.command('cancel <run-id>').action(async (id: string) =>
    action(program, async (app) => {
      const run = app.state.get('runs', id);
      if (run)
        app.state.put('runs', { ...run, cancelled: true, state: 'cancelled' });
      return {
        status: run ? 'cancelled' : 'missing',
        next: `bun run password-manager resume ${id}`,
      };
    })()
  );
}

async function cleanupSelectedExport(
  app: AppContext,
  id: string,
  apply: boolean
) {
  const preview = await cleanupExport({ ...app, sourceId: id, apply: false });
  if (!apply) return preview;
  await updateConfig(app, (current) => ({
    ...current,
    sources: current.sources.map((s) =>
      s.id === id ? { ...s, enabled: false } : s
    ),
  }));
  return cleanupExport({ ...app, sourceId: id, apply: true });
}
