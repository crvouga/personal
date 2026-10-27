import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, '../../packages/infra/tofu/check.sh');

function run(group: string, failure = '') {
  const directory = mkdtempSync(join(tmpdir(), 'infra-validation-'));
  try {
    const log = join(directory, 'commands');
    for (const command of ['tofu', 'python3', 'bun'])
      writeFileSync(
        join(directory, command),
        '#!/bin/bash\nprintf "%s %s\\n" "${0##*/}" "$*" >> "$CI_TEST_LOG"\nif [[ -n "$CI_TEST_FAILURE" && "$*" == *"$CI_TEST_FAILURE"* ]]; then exit 19; fi\n',
        { mode: 0o700 }
      );
    const result = Bun.spawnSync(['bash', script, group], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        CI_TEST_LOG: log,
        CI_TEST_FAILURE: failure,
      },
    });
    return {
      code: result.exitCode,
      commands:
        result.exitCode === 2
          ? []
          : readFileSync(log, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('distributed OpenTofu groups cover exactly the full local suite', () => {
  const all = run('all');
  const groups = ['validate', 'modules', 'contracts'].flatMap((name) => {
    const group = run(name);
    expect(group.code).toBe(0);
    return group.commands;
  });
  expect(all.code).toBe(0);
  expect(groups).toEqual(all.commands);
  const contracts = groups.find((command) =>
    command.startsWith('python3 tests/run-contracts.py ')
  );
  expect(contracts?.split(' ').slice(2)).toEqual([
    'bootstrap',
    'railway-settings',
    'registry-credentials',
    'foundation-controls',
    'publisher-handoff',
    'foundation',
    'vault',
    'auth-hosting',
    'cloudflare-dns-settings',
    'github-secrets',
    'domains',
    'aliases',
  ]);
  expect(
    groups.filter((command) => command.endsWith(' validate'))
  ).toHaveLength(9);
  expect(
    groups.filter(
      (command) => command.endsWith(' test') && command.startsWith('tofu')
    )
  ).toHaveLength(5);
  for (const init of groups.filter((command) => command.includes(' init ')))
    expect(init).toContain('-backend=false -input=false');
}, 15_000);

test('each OpenTofu lane propagates a failing command and rejects unknown groups', () => {
  for (const [group, command] of [
    ['validate', 'validate'],
    ['modules', 'test'],
    ['contracts', 'tests/run-contracts.py'],
  ])
    expect(run(group!, command!).code).toBe(19);
  expect(run('typo').code).toBe(2);
});
