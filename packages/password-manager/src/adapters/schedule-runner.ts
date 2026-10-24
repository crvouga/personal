import { homedir } from 'node:os';
import { join } from 'node:path';
import { command, type Command } from './process.ts';
export const SCHEDULE_LABEL = 'dev.workspace.password-manager';
export type ScheduleExecute = (input: Command) => Promise<string>;
export interface ScheduleHost {
  platform: string;
  home: string;
  uid: number;
  execute: ScheduleExecute;
}
export function scheduleHost(): ScheduleHost {
  return {
    platform: process.platform,
    home: homedir(),
    uid: process.getuid!(),
    execute: command,
  };
}
export async function scheduleActive(
  host: ScheduleHost = scheduleHost()
): Promise<boolean> {
  try {
    if (host.platform === 'darwin')
      await host.execute({
        executable: '/bin/launchctl',
        args: ['print', `gui/${host.uid}/${SCHEDULE_LABEL}`],
      });
    else
      await host.execute({
        executable: '/usr/bin/systemctl',
        args: ['--user', 'is-active', `${SCHEDULE_LABEL}.timer`],
      });
    return true;
  } catch {
    return false;
  }
}
export async function activateSchedule(
  host: ScheduleHost = scheduleHost()
): Promise<void> {
  if (host.platform === 'darwin')
    await host.execute({
      executable: '/bin/launchctl',
      args: [
        'bootstrap',
        `gui/${host.uid}`,
        join(host.home, 'Library', 'LaunchAgents', `${SCHEDULE_LABEL}.plist`),
      ],
    });
  else {
    await host.execute({
      executable: '/usr/bin/systemctl',
      args: ['--user', 'daemon-reload'],
    });
    await host.execute({
      executable: '/usr/bin/systemctl',
      args: ['--user', 'enable', '--now', `${SCHEDULE_LABEL}.timer`],
    });
  }
}
export async function deactivateSchedule(
  host: ScheduleHost = scheduleHost()
): Promise<void> {
  if (host.platform === 'darwin')
    await host.execute({
      executable: '/bin/launchctl',
      args: ['bootout', `gui/${host.uid}/${SCHEDULE_LABEL}`],
    });
  else
    await host.execute({
      executable: '/usr/bin/systemctl',
      args: ['--user', 'disable', '--now', `${SCHEDULE_LABEL}.timer`],
    });
}
