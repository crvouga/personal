import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiredMoveTargets } from './deploy-preflight';

const moved = {
  severity: 'error',
  summary: 'Moved resource instances excluded by targeting',
  // Recorded targets from CI run 40074646707, before Railway was contacted.
  detail: `To create a valid plan, either remove your -target=... options altogether or
add the following additional target options:
  -target="github_repository_file.application_owned_publishers"
  -target="github_repository_file.publish"
  -target="github_repository_ruleset.application_default_branch"
  -target="github_repository_ruleset.mockingbird_main"
`,
};
const diagnostic = (error: unknown) =>
  JSON.stringify({ type: 'diagnostic', diagnostic: error });
const targets = [
  'github_repository_file.application_owned_publishers',
  'github_repository_file.publish',
  'github_repository_ruleset.application_default_branch',
  'github_repository_ruleset.mockingbird_main',
];

test('uses all move endpoints requested by OpenTofu, deduplicated', () => {
  expect(
    requiredMoveTargets([diagnostic(moved), diagnostic(moved)].join('\n'))
  ).toEqual(targets);
  const address = 'module.services["example"].railway_service.this';
  expect(
    requiredMoveTargets(
      diagnostic({ ...moved, detail: `  -target=${JSON.stringify(address)}\n` })
    )
  ).toEqual([address]);
});

for (const output of [
  '',
  'not JSON',
  diagnostic(undefined),
  diagnostic({ ...moved, detail: 'missing target suggestions' }),
  diagnostic({ ...moved, detail: null }),
  diagnostic({ ...moved, detail: '-target="unterminated' }),
  diagnostic({
    severity: 'warning',
    summary: 'Resource targeting is in effect',
  }),
  diagnostic({ severity: 'error', summary: 'Not Authorized', detail: '' }),
  `${diagnostic(moved)}\n${diagnostic({ severity: 'error', summary: 'Not Authorized', detail: '' })}`,
  `${diagnostic(moved)}\nmalformed event`,
])
  test(`refuses to expand targets for unknown, malformed or mixed failures: ${output}`, () => {
    expect(requiredMoveTargets(output)).toBeNull();
  });

for (const scenario of ['success', 'moved', 'denied', 'mixed', 'still-moved'])
  test(`preflight ${scenario} stays read-only and reports the final result`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'deploy-preflight-'));
    const log = join(directory, 'commands');
    const summary = join(directory, 'summary');
    try {
      const errors =
        scenario === 'denied'
          ? diagnostic({ severity: 'error', summary: 'Not Authorized' })
          : diagnostic(moved) +
            (scenario === 'mixed'
              ? '\n' +
                diagnostic({ severity: 'error', summary: 'Not Authorized' })
              : '');
      writeFileSync(join(directory, 'diagnostics'), errors);
      writeFileSync(
        join(directory, 'tofu'),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$PREFLIGHT_COMMANDS"
if [ "$PREFLIGHT_SCENARIO" = success ]; then exit 0; fi
if [ "$(wc -l < "$PREFLIGHT_COMMANDS")" -eq 1 ] || [ "$PREFLIGHT_SCENARIO" = still-moved ]; then
  cat "$PREFLIGHT_DIAGNOSTICS"
  exit 1
fi
exit 0
`,
        { mode: 0o700 }
      );
      const result = Bun.spawnSync(
        [process.execPath, join(import.meta.dirname, 'deploy-preflight.ts')],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            PREFLIGHT_COMMANDS: log,
            PREFLIGHT_DIAGNOSTICS: join(directory, 'diagnostics'),
            PREFLIGHT_SCENARIO: scenario,
            GITHUB_STEP_SUMMARY: summary,
          },
        }
      );
      const commands = readFileSync(log, 'utf8').trim().split('\n');
      const expanded = scenario === 'moved' || scenario === 'still-moved';
      expect(commands).toHaveLength(expanded ? 2 : 1);
      const initial =
        '-chdir=packages/infra/tofu/foundation plan -json -refresh-only -input=false -lock=false -parallelism=1 -target=railway_project.workspace';
      expect(commands[0]).toBe(initial);
      if (expanded)
        expect(commands[1]).toBe(
          initial + targets.map((target) => ` -target=${target}`).join('')
        );
      expect(commands.join('\n')).not.toMatch(/\bapply\b|-out=/);
      const failed = !['success', 'moved'].includes(scenario);
      expect(result.exitCode).toBe(failed ? 1 : 0);
      if (failed) {
        expect(readFileSync(summary, 'utf8')).toContain(
          'See the diagnostics for state, configuration or provider access errors'
        );
        expect(result.stderr.toString()).toContain(
          '::error title=Deployment preflight failed::'
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
