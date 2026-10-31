/** Read-only gate for the one-time workspace -> personal GitHub state adoption. */
type Change = {
  address: string;
  type: string;
  mode?: string;
  change: {
    actions: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
};
type Plan = { resource_changes?: Change[] };
const FORGET = new Set([
  'github_issue_labels.workspace',
  'github_repository_vulnerability_alerts.workspace',
  'github_repository_dependabot_security_updates.workspace',
]);

/** This provider only waits locally; source metadata participates in its trigger. */
function isUnchangedVaultReadinessWait(item: Change): boolean {
  const before = item.change.before;
  const after = item.change.after;
  const oldTriggers = before?.['triggers'] as
    Record<string, unknown> | undefined;
  const newTriggers = after?.['triggers'] as
    Record<string, unknown> | undefined;
  const destroyWait = after?.['destroy_duration'];
  return (
    item.address === 'time_sleep.vault_start' &&
    item.type === 'time_sleep' &&
    item.change.actions.join(',') === 'delete,create' &&
    before?.['create_duration'] === '90s' &&
    after?.['create_duration'] === '90s' &&
    (destroyWait == null || destroyWait === '' || destroyWait === '0s') &&
    typeof oldTriggers?.['image'] === 'string' &&
    typeof oldTriggers?.['database'] === 'string' &&
    oldTriggers['image'] === newTriggers?.['image'] &&
    oldTriggers['database'] === newTriggers?.['database']
  );
}

export function checkRepositoryRename(plan: Plan): {
  migration: boolean;
  checked: number;
} {
  const changes = (plan.resource_changes ?? []).filter(
    (item) => item.mode !== 'data'
  );
  const migration = changes.some(
    (item) =>
      item.type.startsWith('github_') &&
      (item.change.before?.['repository'] === 'workspace' ||
        (item.type === 'github_repository' &&
          item.change.before?.['name'] === 'workspace') ||
        (FORGET.has(item.address) && item.change.actions.includes('forget')))
  );
  if (!migration) return { migration: false, checked: 0 };
  for (const item of changes) {
    const actions = item.change.actions.join(',');
    const allowed =
      actions === 'no-op' ||
      (actions === 'update' && item.type.startsWith('github_')) ||
      (actions === 'forget' && FORGET.has(item.address)) ||
      isUnchangedVaultReadinessWait(item);
    if (
      actions === 'update' &&
      [
        'github_issue_labels',
        'github_repository_vulnerability_alerts',
        'github_repository_dependabot_security_updates',
      ].includes(item.type)
    ) {
      throw new Error(
        `Repository rename refuses label/security changes at ${item.address}; imported objects must be unchanged.`
      );
    }
    if (!allowed)
      throw new Error(
        `Repository rename refuses ${actions} at ${item.address}; review the saved plan before any apply.`
      );
    if (
      item.type === 'github_repository' &&
      item.change.before?.['name'] === 'workspace' &&
      item.change.after?.['name'] !== 'personal'
    ) {
      throw new Error(
        `Unexpected canonical repository at ${item.address}; refusing apply.`
      );
    }
    for (const key of ['repository_id', 'repo_id']) {
      const before = item.change.before?.[key];
      const after = item.change.after?.[key];
      if (before != null && after != null && before !== after) {
        throw new Error(
          `Repository identity changed at ${item.address}; refusing apply.`
        );
      }
    }
    if (
      item.change.before?.['repository'] === 'workspace' &&
      actions === 'update' &&
      item.change.after?.['repository'] !== 'personal'
    ) {
      throw new Error(
        `Unexpected repository target at ${item.address}; refusing apply.`
      );
    }
  }
  return { migration: true, checked: changes.length };
}

if (import.meta.main) {
  const result = checkRepositoryRename(
    JSON.parse(await Bun.stdin.text()) as Plan
  );
  console.log(
    `Repository rename plan: ${result.migration ? `${result.checked} resource actions checked; no destructive cloud actions` : 'already adopted / no rename changes'}.`
  );
}
