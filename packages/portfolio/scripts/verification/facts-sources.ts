/**
 * Platform facts read from infrastructure and workspace source files.
 *
 * Each reader parses the file that *owns* the fact rather than a copy of it,
 * and throws when the shape it relies on is gone, so a refactor elsewhere in
 * the monorepo fails `bun run facts` instead of producing a silent zero.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const INVENTORY = 'packages/infra/tofu/modules/inventory/inventory.tf.json';
const TOFU_DIR = 'packages/infra/tofu';
const HEALTH_RUN = 'packages/infra/lib/health/run.ts';
const AGENT_COMMANDS = 'scripts/agent-commands.ts';
const MAIN_RULESET = 'packages/infra/tofu/foundation/repository.tf';

type Row = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const read = (root: string, path: string): string =>
  readFileSync(join(root, path), 'utf8');

const at = (value: unknown, key: string, where: string): unknown => {
  if (!isRecord(value) || !(key in value)) {
    throw new Error(`${where}: missing \`${key}\``);
  }
  return value[key];
};

const inventoryOf = (root: string): unknown =>
  at(
    at(JSON.parse(read(root, INVENTORY)), 'locals', INVENTORY),
    'inventory',
    INVENTORY
  );

const contextsOf = (rule: unknown): readonly string[] => {
  const checks = at(
    at(rule, 'parameters', INVENTORY),
    'required_status_checks',
    INVENTORY
  );
  if (!Array.isArray(checks))
    throw new Error(`${INVENTORY}: checks are not a list`);
  return checks.map((check) => {
    const context = at(check, 'context', INVENTORY);
    if (typeof context !== 'string')
      throw new Error(`${INVENTORY}: bad context`);
    return context;
  });
};

/**
 * `github_repository_ruleset.main` (foundation/repository.tf) takes its
 * required checks from `local.check_rule`, which is the inventory's
 * `github.pr_ready.ruleset` rule of type `required_status_checks`. The wiring
 * is asserted so the inventory cannot stop being the source unnoticed.
 */
export const readRequiredChecks = (root: string): readonly string[] => {
  if (
    !read(root, MAIN_RULESET).includes(
      'local.check_rule.required_status_checks'
    )
  ) {
    throw new Error(
      `${MAIN_RULESET}: main ruleset no longer reads local.check_rule`
    );
  }
  const ruleset = at(
    at(at(inventoryOf(root), 'github', INVENTORY), 'pr_ready', INVENTORY),
    'ruleset',
    INVENTORY
  );
  const rules = at(ruleset, 'rules', INVENTORY);
  const rule = Array.isArray(rules)
    ? rules.find(
        (entry) => isRecord(entry) && entry['type'] === 'required_status_checks'
      )
    : undefined;
  return contextsOf(rule);
};

/** `locals.inventory.services`: every hosted service is one entry. */
export const readInventoryServices = (root: string): number => {
  const services = at(inventoryOf(root), 'services', INVENTORY);
  if (!Array.isArray(services))
    throw new Error(`${INVENTORY}: services is not a list`);
  return services.length;
};

const hasTerraformBlock = (dir: string): boolean =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.tf'))
    .some((name) =>
      /^terraform\s*\{/m.test(readFileSync(join(dir, name), 'utf8'))
    );

/**
 * A root is a direct child of `packages/infra/tofu/` (other than `modules/`)
 * with a top-level `terraform {}` block — the directories `tofu -chdir=` runs
 * in. `tests/` holds contract fixtures and no `.tf` files.
 */
export const readOpenTofuRoots = (root: string): readonly string[] =>
  readdirSync(join(root, TOFU_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'modules')
    .map((entry) => entry.name)
    .filter((name) => hasTerraformBlock(join(root, TOFU_DIR, name)))
    .sort();

/** `prevent_destroy = true` occurrences across the given tracked `.tf` files. */
export const countPreventDestroy = (
  root: string,
  files: readonly string[]
): number =>
  files
    .filter((path) => path.startsWith(`${TOFU_DIR}/`) && path.endsWith('.tf'))
    .reduce(
      (total, path) =>
        total +
        (read(root, path).match(/\bprevent_destroy\s*=\s*true\b/g)?.length ??
          0),
      0
    );

/** The text of `const <name> ... = [ ... ];`, the array literal only. */
const arrayLiteral = (source: string, name: string, where: string): string => {
  const start = source.search(new RegExp(`\\b${name}\\b[^=]*=\\s*\\[`));
  const end = start < 0 ? -1 : source.indexOf('\n];', start);
  if (end < 0) throw new Error(`${where}: no ${name} array literal`);
  return source.slice(start, end);
};

/**
 * Registered health groups: entries of `HEALTH_GROUPS` in health/run.ts, one
 * `run: check…` each. Counting registrations rather than `check-*.ts` files
 * matters because `check-services.ts` registers two groups and helpers such
 * as `cache-probe.ts` register none.
 */
export const countHealthChecks = (root: string): number => {
  const groups = arrayLiteral(
    read(root, HEALTH_RUN),
    'HEALTH_GROUPS',
    HEALTH_RUN
  );
  const count = groups.match(/\brun:\s*check\w+/g)?.length ?? 0;
  if (count === 0)
    throw new Error(`${HEALTH_RUN}: HEALTH_GROUPS registers nothing`);
  return count;
};

/** `name:` of each entry in `HARNESSES` in scripts/agent-commands.ts. */
export const readAgentHarnesses = (root: string): readonly string[] => {
  const harnesses = arrayLiteral(
    read(root, AGENT_COMMANDS),
    'HARNESSES',
    AGENT_COMMANDS
  );
  const names = [...harnesses.matchAll(/\bname:\s*'([^']+)'/g)].map(
    (match) => match[1] ?? ''
  );
  if (names.length === 0)
    throw new Error(`${AGENT_COMMANDS}: HARNESSES lists nothing`);
  return names;
};

/**
 * Bun workspace packages: the root `workspaces` glob is `packages/*`, and a
 * directory there is a package only when it has a tracked `package.json`
 * (`packages/eslint-rules` and `packages/vault-service` have none).
 */
export const countWorkspacePackages = (files: readonly string[]): number =>
  files.filter((path) => /^packages\/[^/]+\/package\.json$/.test(path)).length;
