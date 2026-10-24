import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import {
  scheduleActive,
  activateSchedule,
  deactivateSchedule,
  SCHEDULE_LABEL,
  type ScheduleHost,
  scheduleHost,
} from './schedule-runner.ts';
import { ManagerError } from '../domain/errors.ts';
const LABEL = SCHEDULE_LABEL;
function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
export function scheduleDefinition(input: {
  cli: string;
  directory: string;
  hour: number;
  platform: string;
  home?: string;
}) {
  const args = [
    process.execPath,
    input.cli,
    '--state-dir',
    input.directory,
    '--non-interactive',
    'run',
  ];
  if (input.platform === 'darwin')
    return {
      files: [
        {
          path: join(
            input.home ?? homedir(),
            'Library',
            'LaunchAgents',
            `${LABEL}.plist`
          ),
          content: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>${input.hour}</integer><key>Minute</key><integer>0</integer></dict><key>ProcessType</key><string>Background</string></dict></plist>`,
        },
      ],
    };
  if (input.platform === 'linux')
    return linuxDefinition(args, input.hour, input.home ?? homedir());
  throw new ManagerError('unsupported-platform');
}
function linuxDefinition(args: string[], hour: number, home: string) {
  const directory = join(home, '.config', 'systemd', 'user');
  const quote = (s: string) =>
    '"' +
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') +
    '"';
  return {
    files: [
      {
        path: join(directory, `${LABEL}.service`),
        content: `[Unit]\nDescription=Private account discovery and maintenance\n[Service]\nType=oneshot\nExecStart=${args.map(quote).join(' ')}\nUMask=0077\nStandardOutput=null\nStandardError=null\n`,
      },
      {
        path: join(directory, `${LABEL}.timer`),
        content: `[Unit]\nDescription=Daily private credential maintenance\n[Timer]\nOnCalendar=*-*-* ${hour}:00:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n`,
      },
    ],
  };
}
export async function schedule(
  input: {
    action: 'install' | 'status' | 'remove';
    cli: string;
    directory: string;
    hour: number;
  },
  host: ScheduleHost = scheduleHost()
) {
  const definition = scheduleDefinition({
    ...input,
    platform: host.platform,
    home: host.home,
  });
  const matches = definition.files.every(
    (f) => existsSync(f.path) && readFileSync(f.path, 'utf8') === f.content
  );
  const active = await scheduleActive(host);
  if (input.action === 'status')
    return {
      installed: matches && active,
      active,
      definitionMatches: matches,
      files: definition.files.map((f) => f.path),
    };
  if (active && (input.action === 'remove' || !matches))
    await deactivateSchedule(host);
  writeScheduleFiles(definition.files, input.action);
  if (input.action === 'install' && (!matches || !active))
    await activateSchedule(host);
  return {
    installed: input.action === 'install',
    next: 'bun run password-manager schedule status',
  };
}

function writeScheduleFiles(
  files: { path: string; content: string }[],
  action: string
): void {
  for (const file of files) {
    if (action === 'remove') {
      if (existsSync(file.path)) unlinkSync(file.path);
    } else {
      if (
        existsSync(file.path) &&
        readFileSync(file.path, 'utf8') === file.content
      )
        continue;
      mkdirSync(join(file.path, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(file.path, file.content, { mode: 0o600 });
    }
  }
}
