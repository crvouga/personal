import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { deploymentPlan } from './ci/deploy-plan';
import { loadServicesConfig } from '../packages/infra/lib/services';

test('normal development cannot launch the dormant server or its setup dependency', () => {
  const result = Bun.spawnSync(['bunx', 'turbo', 'run', 'dev', '--dry=json'], {
    cwd: join(import.meta.dir, '..'),
    timeout: 20000,
  });
  expect(result.exitCode).toBe(0);
  const plan = JSON.parse(result.stdout.toString()) as {
    tasks: { taskId: string; command: string }[];
  };
  expect(
    plan.tasks.filter(
      (task) =>
        task.taskId.startsWith('@pkgs/turborepo-remote-cache#') &&
        task.command !== '<NONEXISTENT>'
    )
  ).toEqual([]);
}, 30000);

test('deployment requests cannot reactivate the retired hosting entry', () => {
  expect(() =>
    deploymentPlan(loadServicesConfig(), {
      event: 'repository_dispatch',
      action: 'deploy',
      paths: [],
      sha: 'retirement-fixture',
      serviceId: 'turborepo',
    })
  ).toThrow('Unknown deployable service: turborepo');
});
