/**
 * `bun run check` is the local gate; CI runs the same steps as parallel lanes.
 * This test fails when a step is added to one but not the other.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const scripts: Record<string, string> = JSON.parse(
  read('package.json')
).scripts;
const ci = parse(read('.github/workflows/ci.yml'));
const setup = parse(read('.github/actions/setup/action.yml'));

type Step = { run?: string };
const fastJobs = ['repository', 'packages', 'infra'];
const runs = [
  ...fastJobs.flatMap((job) =>
    (ci.jobs[job].steps as Step[]).map((s) => s.run ?? '')
  ),
  ...(setup.runs.steps as Step[]).map((s) => s.run ?? ''),
]
  .join('\n')
  .replace(/\s+/g, ' ');
const turboTasks = new Set(
  [...runs.matchAll(/turbo run ([\w: -]+?)(?= \$\{\{|$| &&)/g)].flatMap((m) =>
    m[1].trim().split(' ')
  )
);

const steps = scripts.check.split('&&').map((part) => part.trim());

test('every bun run check step runs in a fast CI lane', () => {
  for (const step of steps) {
    const turbo = /^turbo run (.+)$/.exec(step);
    if (turbo) {
      for (const task of turbo[1].split(' '))
        expect(turboTasks).toContain(task);
      continue;
    }
    const name = /^bun run ([\w:-]+)$/.exec(step)?.[1];
    expect(name, `unrecognized check step: ${step}`).toBeDefined();
    const covered =
      runs.includes(`bun run ${name}`) || runs.includes(scripts[name!]);
    expect(covered, `CI does not run \`${step}\``).toBe(true);
  }
});

test('CI lanes run no turbo task that bun run check skips', () => {
  const local = new Set(
    steps.flatMap((s) => /^turbo run (.+)$/.exec(s)?.[1].split(' ') ?? [])
  );
  for (const task of turboTasks) expect(local).toContain(task);
});

test('the OpenTofu lanes cover every check.sh group', () => {
  const groups = /case "\$group" in all\|([\w|]+)\)/
    .exec(read('packages/infra/tofu/check.sh'))![1]
    .split('|');
  expect(new Set(ci.jobs.infra.strategy.matrix.group)).toEqual(new Set(groups));
});
