/**
 * Hourly agent PR hygiene (agent-prs.yml). Stale handling is actions/stale.
 *   - Agent PRs (branches t3/* or agent/*) get `agent-generated`, and squash
 *     auto-merge once they are out of draft and not held.
 *   - Branches behind main are updated; a conflict labels `needs-human`,
 *     turns off auto-merge and comments the conflicting files.
 *   - Dependabot PRs get `deps` and squash auto-merge.
 * GH_TOKEN must be a token whose pushes trigger workflows (not GITHUB_TOKEN),
 * or updated branches never get the required checks.
 */
import { gh, ghJson, repository } from './github';

export type PullRequest = {
  number: number;
  headRefName: string;
  headRefOid: string;
  author: { login: string };
  isDraft: boolean;
  labels: { name: string }[];
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  autoMergeRequest: unknown;
};
export type Action =
  | { kind: 'label'; label: string }
  | { kind: 'update-branch' }
  | { kind: 'conflict' }
  | { kind: 'auto-merge' };

export const AGENT_BRANCH = /^(t3|agent)\//;
export const HOLD_LABELS = ['needs-human', 'do-not-merge'];
const isDependabot = (pr: PullRequest) => /dependabot/.test(pr.author.login);

export function plan(pr: PullRequest, behindBy: number): Action[] {
  const labels = new Set(pr.labels.map((l) => l.name));
  const actions: Action[] = [];
  const wantsAutoMerge =
    !pr.isDraft &&
    !pr.autoMergeRequest &&
    !HOLD_LABELS.some((label) => labels.has(label));
  if (isDependabot(pr)) {
    if (!labels.has('deps')) actions.push({ kind: 'label', label: 'deps' });
    if (wantsAutoMerge) actions.push({ kind: 'auto-merge' });
    return actions;
  }
  if (!AGENT_BRANCH.test(pr.headRefName)) return actions;
  if (!labels.has('agent-generated'))
    actions.push({ kind: 'label', label: 'agent-generated' });
  if (pr.mergeable === 'CONFLICTING') {
    if (!labels.has('needs-human')) actions.push({ kind: 'conflict' });
    return actions;
  }
  if (pr.mergeable === 'MERGEABLE' && behindBy > 0)
    actions.push({ kind: 'update-branch' });
  if (wantsAutoMerge) actions.push({ kind: 'auto-merge' });
  return actions;
}

/** Files that conflict when merging main into the PR head (git >= 2.38). */
function conflictingFiles(branch: string): string[] {
  Bun.spawnSync(['git', 'fetch', '--quiet', 'origin', 'main', branch]);
  const result = Bun.spawnSync(
    [
      'git',
      'merge-tree',
      '--write-tree',
      '--name-only',
      '--no-messages',
      'origin/main',
      `origin/${branch}`,
    ],
    { stdout: 'pipe' }
  );
  return result.stdout.toString().split('\n').slice(1).filter(Boolean);
}

if (import.meta.main) {
  const repo = repository();
  const prs = ghJson<PullRequest[]>([
    'pr',
    'list',
    '-R',
    repo,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,headRefName,headRefOid,author,isDraft,labels,mergeable,autoMergeRequest',
  ]);
  let failures = 0;
  for (const pr of prs) {
    try {
      const behindBy = AGENT_BRANCH.test(pr.headRefName)
        ? Number(
            gh([
              'api',
              `repos/${repo}/compare/main...${pr.headRefOid}`,
              '--jq',
              '.behind_by',
            ]).trim()
          )
        : 0;
      for (const action of plan(pr, behindBy)) {
        const n = String(pr.number);
        console.log(`#${n}: ${action.kind}`);
        if (action.kind === 'label')
          gh(['pr', 'edit', n, '-R', repo, '--add-label', action.label]);
        if (action.kind === 'auto-merge')
          gh(['pr', 'merge', n, '-R', repo, '--auto', '--squash']);
        if (action.kind === 'update-branch')
          gh(['pr', 'update-branch', n, '-R', repo]);
        if (action.kind === 'conflict') {
          const files = conflictingFiles(pr.headRefName);
          gh(['pr', 'edit', n, '-R', repo, '--add-label', 'needs-human']);
          Bun.spawnSync(['gh', 'pr', 'merge', n, '-R', repo, '--disable-auto']);
          gh(
            ['pr', 'comment', n, '-R', repo, '--body-file', '-'],
            [
              'This branch conflicts with `main`. Labeled `needs-human` and turned off auto-merge.',
              '',
              'Conflicting files:',
              ...(files.length
                ? files.map((f) => `- \`${f}\``)
                : ['- (could not compute; merge `main` locally)']),
              '',
              'To fix: `git fetch origin && git merge origin/main`, resolve, run `bun run check`, push, then remove `needs-human`.',
            ].join('\n')
          );
        }
      }
    } catch (error) {
      failures++;
      console.error(`#${pr.number}: ${(error as Error).message}`);
    }
  }
  if (failures) process.exit(1);
}
