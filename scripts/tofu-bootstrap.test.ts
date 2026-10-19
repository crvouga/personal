import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const action = parse(
  readFileSync(
    join(import.meta.dirname, '../.github/actions/tofu/action.yml'),
    'utf8'
  )
);
const step = action.runs.steps.find(
  (candidate: { name?: string }) =>
    candidate.name === 'Ensure application schemas exist before Atlas planning'
);

test('schema bootstrap applies only creation of the empty application schemas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tofu-bootstrap-'));
  const plan = join(directory, 'plan.json');
  const applied = join(directory, 'applied');
  const inventory = join(directory, 'inventory.json');
  const inventoryFor = (enabled: boolean) =>
    writeFileSync(
      inventory,
      JSON.stringify({ locals: { inventory: { auth_relay: { enabled } } } })
    );
  inventoryFor(false);
  writeFileSync(
    join(directory, 'tofu'),
    '#!/bin/sh\ncase "$2" in state) printf "%s\\n" "${TEST_STATE:-}";; show) cat "$TEST_PLAN";; apply) touch "$TEST_APPLIED";; esac\n',
    { mode: 0o755 }
  );
  const cases = [
    [
      [
        {
          address: 'postgresql_schema.external_app',
          change: { actions: ['create'] },
        },
      ],
      false,
    ],
    [
      [
        {
          address: 'postgresql_schema.external_app',
          change: { actions: ['delete', 'create'] },
        },
      ],
      false,
    ],
    [
      [
        {
          address: 'atlas_schema.external_app',
          change: { actions: ['create'] },
        },
      ],
      false,
    ],
    [undefined, true],
    [[], true],
    [[{ mode: 'data', change: { actions: ['read'] } }], true],
    [
      [{ address: 'postgresql_schema.fleet', change: { actions: ['create'] } }],
      true,
    ],
    [
      [{ address: 'postgresql_schema.fleet', change: { actions: ['no-op'] } }],
      true,
    ],
    [
      [
        {
          address: 'postgresql_schema.fleet',
          change: { actions: ['delete', 'create'] },
        },
      ],
      false,
    ],
    [
      [{ address: 'postgresql_schema.fleet', change: { actions: ['update'] } }],
      false,
    ],
    [
      [
        {
          address: 'planetscale_postgres_branch.openbao',
          change: { actions: ['create'] },
        },
      ],
      false,
    ],
  ] as const;
  try {
    for (const [changes, allowed] of cases) {
      rmSync(applied, { force: true });
      writeFileSync(plan, JSON.stringify({ resource_changes: changes }));
      const result = Bun.spawnSync(['bash', '-c', step.run], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          TEST_PLAN: plan,
          TEST_APPLIED: applied,
          TOFU_INVENTORY: inventory,
        },
      });
      expect(result.exitCode === 0).toBe(allowed);
      expect(existsSync(applied)).toBe(allowed);
    }
    // Existing installations must leave state moves/forgetting to the full
    // foundation plan instead of issuing a partial plan that excludes them.
    rmSync(applied, { force: true });
    writeFileSync(plan, 'invalid: targeted planning must not run');
    const existing = Bun.spawnSync(['bash', '-c', step.run], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TEST_PLAN: plan,
        TEST_APPLIED: applied,
        TEST_STATE: 'postgresql_schema.fleet',
        TOFU_INVENTORY: inventory,
      },
    });
    expect(existing.exitCode).toBe(0);
    expect(existsSync(applied)).toBe(false);

    // With the relay enabled, its empty schemas and restricted roles follow the
    // same create-only rule; anything else in the targeted plan is refused.
    inventoryFor(true);
    const authCases = [
      [
        [
          {
            address:
              'planetscale_postgres_branch_role.auth_console["production"]',
            change: { actions: ['create'] },
          },
          {
            address: 'postgresql_schema.auth_console["production"]',
            change: { actions: ['create'] },
          },
        ],
        true,
      ],
      [
        [
          {
            address: 'postgresql_schema.auth_console["production"]',
            change: { actions: ['delete', 'create'] },
          },
        ],
        false,
      ],
      [
        [
          {
            address: 'atlas_schema.auth_console["production"]',
            change: { actions: ['create'] },
          },
        ],
        false,
      ],
    ] as const;
    for (const [changes, allowed] of authCases) {
      rmSync(applied, { force: true });
      writeFileSync(plan, JSON.stringify({ resource_changes: changes }));
      const result = Bun.spawnSync(['bash', '-c', step.run], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          TEST_PLAN: plan,
          TEST_APPLIED: applied,
          TEST_STATE: 'postgresql_schema.fleet',
          TOFU_INVENTORY: inventory,
        },
      });
      expect(result.exitCode === 0).toBe(allowed);
      expect(existsSync(applied)).toBe(allowed);
    }
    // Already-managed auth schemas are left to the full plan.
    rmSync(applied, { force: true });
    writeFileSync(plan, 'invalid: targeted planning must not run');
    const managed = Bun.spawnSync(['bash', '-c', step.run], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        TEST_PLAN: plan,
        TEST_APPLIED: applied,
        TEST_STATE:
          'postgresql_schema.fleet\npostgresql_schema.auth_console["production"]',
        TOFU_INVENTORY: inventory,
      },
    });
    expect(managed.exitCode).toBe(0);
    expect(existsSync(applied)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
