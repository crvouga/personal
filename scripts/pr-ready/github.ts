/**
 * Pull-request commands for `pr-ready`: open/inspect the PR, poll checks,
 * fetch failing logs, and merge (merge commits only).
 */
import { readFile } from 'node:fs/promises';
import { currentBranch, remoteBranchExists } from './git';
import {
  ALLOWED_MERGE_METHODS,
  CommandError,
  EXIT,
  TRUNK_BRANCH,
  exactlyOne,
  gh,
  intFlag,
  lines,
  ok,
  parseJson,
  run,
  sleep,
  usageError,
  type Flags,
  type Outcome,
} from './lib';

const PR_FIELDS = [
  'number',
  'url',
  'state',
  'title',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'baseRefName',
  'headRefName',
].join(',');

const CHECK_FIELDS = 'name,state,bucket,link,workflow';

export type PullRequest = {
  number: number;
  url: string;
  state: string;
  title: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type Check = {
  name: string;
  state: string;
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';
  link: string;
  workflow: string;
};

export async function viewPr(branch: string): Promise<PullRequest | null> {
  const result = await run(['gh', 'pr', 'view', branch, '--json', PR_FIELDS]);
  if (result.code === 0)
    return parseJson<PullRequest>('pr-view', result.stdout);
  if (/no (open )?pull requests? found/i.test(result.output)) return null;
  throw new CommandError({
    step: 'pr-view',
    output: result.output,
    hint: 'is `gh auth status` ok?',
  });
}

// ---------------------------------------------------------------------------
// pr
// ---------------------------------------------------------------------------

async function readBody(flags: Flags): Promise<string> {
  const source = exactlyOne(flags, 'body', 'body-file');
  return source.name === 'body' ? source.value : readFile(source.value, 'utf8');
}

async function createPr(branch: string, flags: Flags): Promise<PullRequest> {
  const title = flags.values.title;
  if (!title?.trim()) throw usageError('--title is required to create a PR');
  const body = await readBody(flags);
  if (!(await remoteBranchExists(branch))) {
    throw new CommandError({
      step: 'pr',
      output: `branch ${branch} is not on origin`,
      hint: 'run `publish` first',
    });
  }
  const args = [
    'pr',
    'create',
    '--base',
    TRUNK_BRANCH,
    '--head',
    branch,
    '--title',
    title,
    '--body',
    body,
  ];
  if (flags.booleans.has('draft')) args.push('--draft');
  await gh('pr-create', args);
  const pr = await viewPr(branch);
  if (!pr)
    throw new CommandError({
      step: 'pr-create',
      output: 'PR not found after create',
    });
  return pr;
}

export async function prCommand(flags: Flags): Promise<Outcome> {
  const branch = await currentBranch();
  if (branch === TRUNK_BRANCH)
    throw usageError(`cannot open a PR from ${TRUNK_BRANCH}`);
  let pr = await viewPr(branch);
  const created = pr === null || pr.state !== 'OPEN';
  if (!pr || pr.state !== 'OPEN') pr = await createPr(branch, flags);
  if (pr.baseRefName !== TRUNK_BRANCH) {
    throw new CommandError({
      step: 'pr',
      output: `PR #${pr.number} targets ${pr.baseRefName}, not ${TRUNK_BRANCH}`,
      hint: `retarget it: gh pr edit ${pr.number} --base ${TRUNK_BRANCH}`,
    });
  }
  if (flags.booleans.has('ready') && pr.isDraft) {
    await gh('pr-ready', ['pr', 'ready', String(pr.number)]);
    pr = (await viewPr(branch)) ?? pr;
  }
  return ok({ created, pr });
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

export type CheckPoll = { checks: Check[]; noneReported: boolean };

export async function pollChecks(branch: string): Promise<CheckPoll> {
  const result = await run([
    'gh',
    'pr',
    'checks',
    branch,
    '--json',
    CHECK_FIELDS,
  ]);
  const text = result.stdout.trim();
  if (text.startsWith('[')) {
    const checks = parseJson<Check[]>('checks', text);
    return { checks, noneReported: checks.length === 0 };
  }
  if (/no checks reported/i.test(result.output))
    return { checks: [], noneReported: true };
  const noPr = /no pull requests? found/i.test(result.output);
  throw new CommandError({
    step: 'checks',
    output: result.output,
    hint: noPr ? 'run `pr` first' : undefined,
  });
}

const TERMINAL_OK = new Set(['pass', 'skipping']);
const TERMINAL_BAD = new Set(['fail', 'cancel']);

export type CheckSummary = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  failing: Check[];
  pendingChecks: Check[];
  verdict: 'pass' | 'fail' | 'pending';
};

export function summarizeChecks(poll: CheckPoll): CheckSummary {
  const { checks } = poll;
  const failing = checks.filter((check) => TERMINAL_BAD.has(check.bucket));
  const pendingChecks = checks.filter(
    (check) => !TERMINAL_OK.has(check.bucket) && !TERMINAL_BAD.has(check.bucket)
  );
  let verdict: CheckSummary['verdict'] = 'pass';
  if (failing.length > 0) verdict = 'fail';
  else if (poll.noneReported || pendingChecks.length > 0) verdict = 'pending';
  return {
    total: checks.length,
    passed: checks.filter((check) => check.bucket === 'pass').length,
    failed: failing.length,
    pending: pendingChecks.length,
    skipped: checks.filter((check) => check.bucket === 'skipping').length,
    failing,
    pendingChecks,
    verdict,
  };
}

function checksOutcome(
  branch: string,
  poll: CheckPoll,
  timedOut: boolean
): Outcome {
  const summary = summarizeChecks(poll);
  const compact = (check: Check) => ({
    name: check.name,
    bucket: check.bucket,
    link: check.link,
  });
  if (summary.verdict === 'pass') {
    return ok({ branch, verdict: 'pass', checks: poll.checks.map(compact) });
  }
  if (summary.verdict === 'fail') {
    return ok(
      {
        step: 'checks',
        branch,
        verdict: 'fail',
        failing: summary.failing.map(compact),
        hint: 'run `logs --name "<check>"` for each failing check',
      },
      EXIT.fail
    );
  }
  return ok(
    {
      step: 'checks',
      branch,
      verdict: 'pending',
      noneReported: poll.noneReported,
      pending: summary.pendingChecks.map(compact),
      timedOut,
    },
    EXIT.pending
  );
}

export async function checksCommand(flags: Flags): Promise<Outcome> {
  const branch = await currentBranch();
  const intervalMs = intFlag(flags, 'interval', 20) * 1000;
  const deadline = Date.now() + intFlag(flags, 'timeout', 1800) * 1000;
  for (;;) {
    const poll = await pollChecks(branch);
    const verdict = summarizeChecks(poll).verdict;
    const outOfTime = Date.now() + intervalMs > deadline;
    if (verdict !== 'pending' || flags.booleans.has('once') || outOfTime) {
      return checksOutcome(branch, poll, verdict === 'pending' && outOfTime);
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// logs (plain text on success)
// ---------------------------------------------------------------------------

export function parseRunLink(
  link: string
): { runId: string; jobId: string | null } | null {
  const match = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(link);
  if (!match?.[1]) return null;
  return { runId: match[1], jobId: match[2] ?? null };
}

async function linkForCheck(name: string): Promise<string> {
  const { checks } = await pollChecks(await currentBranch());
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) {
    throw new CommandError({
      step: 'logs',
      output: `no check named "${name}"`,
      extra: { available: checks.map((candidate) => candidate.name) },
    });
  }
  return check.link;
}

/** Returns the failing-log tail as plain text (the only non-JSON command). */
export async function logsText(flags: Flags): Promise<string> {
  const name = flags.values.name;
  const url = flags.positional[0];
  if (Boolean(name) === Boolean(url))
    throw usageError('pass exactly one of --name <check> or a run URL');
  const link = name ? await linkForCheck(name) : (url ?? '');
  const ids = parseRunLink(link);
  if (!ids) {
    throw new CommandError({
      step: 'logs',
      output: `not a GitHub Actions run link: ${link}`,
      hint: 'external checks have no Actions logs; open the link instead',
    });
  }
  const args = ids.jobId
    ? ['run', 'view', '--job', ids.jobId, '--log-failed']
    : ['run', 'view', ids.runId, '--log-failed'];
  const log = await gh('logs', args);
  const tail = intFlag(flags, 'tail', 120);
  return `${lines(log).slice(-tail).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

export async function mergeCommand(flags: Flags): Promise<Outcome> {
  const branch = await currentBranch();
  const pr = await viewPr(branch);
  if (!pr)
    throw new CommandError({
      step: 'merge',
      output: `no PR for ${branch}`,
      hint: 'run `pr` first',
    });
  const auto = flags.booleans.has('auto');
  // The one method the OpenTofu inventory allows (squash).
  const method = ALLOWED_MERGE_METHODS[0];
  await gh(
    'merge',
    ['pr', 'merge', branch, `--${method}`, ...(auto ? ['--auto'] : [])],
    'is auto-merge enabled? review the OpenTofu foundation plan'
  );
  return ok({
    requested: auto ? 'auto-merge' : 'merge',
    pr: (await viewPr(branch)) ?? pr,
  });
}
