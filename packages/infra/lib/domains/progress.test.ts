import { describe, expect, test } from 'bun:test';
import { fakeContext } from '../health/fixtures.test-support.js';
import { existingState } from './prerequisites.js';
import { migrationProgress, progressLine, withMigrationProgress, type MigrationProgress } from './progress.js';

describe('migration progress', () => {
  test('startup is immediate, async state reads are visible, and long work emits safe heartbeats', async () => {
    const events: MigrationProgress[] = [];
    const secret = 'private-state-passphrase-never-print';
    const ctx = fakeContext({ env: { TF_VAR_state_passphrase: secret }, fileExists: () => true,
      run: async () => {
        await Bun.sleep(20);
        return { code: 0, stderr: '', stdout: JSON.stringify({ values: { root_module: { resources: [{ values: { password: secret } }] } } }) };
      },
    });
    const result = await withMigrationProgress((event) => events.push(event), async () => {
      expect(events[0].phase).toBe('startup');
      return existingState(ctx);
    }, 5);
    expect(result['TF_VAR_state_passphrase']).toBe(secret);
    expect(events.filter((event) => event.type === 'progress').map((event) => event.message)).toContain('Reading encrypted foundation state (timeout: 60 seconds)');
    expect(events.some((event) => event.type === 'heartbeat' && event.phase === 'state-read')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(progressLine(events.find((event) => event.type === 'heartbeat')!)).toContain('Still running; last stage:');
    const count = events.length;
    await Bun.sleep(15);
    expect(events).toHaveLength(count);
    migrationProgress('outside', 'An unrelated task');
    expect(events).toHaveLength(count);
  });

  test('failure cleans up the heartbeat and concurrent executions keep their own progress', async () => {
    const failed: MigrationProgress[] = [];
    await expect(withMigrationProgress((event) => failed.push(event), async () => {
      migrationProgress('plan', 'Reviewing saved plan', 'blocked.dev');
      await Bun.sleep(15);
      throw new Error('scope rejected');
    }, 5)).rejects.toThrow('scope rejected');
    const count = failed.length;
    const runs = await Promise.all(['first.dev', 'second.dev'].map(async (domain) => {
      const events: MigrationProgress[] = [];
      await withMigrationProgress((event) => events.push(event), async () => {
        await Bun.sleep(15);
        migrationProgress('baseline', 'Checking DNS baseline', domain);
        await Bun.sleep(15);
      }, 5);
      return { domain, events };
    }));
    expect(failed).toHaveLength(count);
    for (const run of runs) {
      expect(run.events.some((event) => event.domain === run.domain)).toBe(true);
      expect(run.events.filter((event) => event.domain).every((event) => event.domain === run.domain)).toBe(true);
    }
  });
});
