/**
 * Turns failing jobs on `main` into GitHub issues agents can pick up.
 *
 * One open issue per failing job, titled `<workflow>: <job> failing on main`
 * and labeled `ci-failed` + `ready`. The body says what failed, where, how to
 * reproduce it and carries a JSON block, like the sticky PR report. A later
 * failure updates the body and comments; a later success of the same job
 * closes the issue.
 *
 * Runs from failure-issues.yml on `workflow_run`; summaries come from the
 * `ci-summary-*` artifacts written by .github/actions/failure-summary. Jobs
 * without a summary get the tail of their failed-step log instead.
 */
import { gh, ghJson, repository } from './github';
import { readSummaries, type Summary } from './pr-report';

export const LABELS = ['ci-failed', 'ready'];
/** Roll-up jobs that only repeat another job's failure. */
const AGGREGATORS = new Set(['Check', 'Slow checks']);
/** Jobs allowed to fail without failing the run. */
const IGNORED = new Set(['Optional integrations']);
const FAILED = new Set(['failure', 'timed_out']);

export type Job = {
  databaseId: number;
  name: string;
  conclusion: string;
  url: string;
};
export type Context = {
  workflow: string;
  sha: string;
  runUrl: string;
};
export type Plan = { open: Job[]; close: Job[] };

export const title = (workflow: string, job: string) =>
  `${workflow}: ${job} failing on main`;

export function plan(jobs: Job[]): Plan {
  const relevant = jobs.filter((job) => !IGNORED.has(job.name));
  let failed = relevant.filter((job) => FAILED.has(job.conclusion));
  if (failed.some((job) => !AGGREGATORS.has(job.name)))
    failed = failed.filter((job) => !AGGREGATORS.has(job.name));
  return {
    open: failed,
    close: relevant.filter((job) => job.conclusion === 'success'),
  };
}

export function summaryFor(job: Job, summaries: Summary[]): Summary | null {
  return (
    summaries.find((s) => s.job === job.name) ??
    summaries.find((s) => job.name.startsWith(s.job)) ??
    null
  );
}

export function renderBody(
  context: Context,
  job: Job,
  summary: Summary | null,
  logTail: string
): string {
  const lines = [
    `**${context.workflow} / ${job.name}** failed on \`main\` at \`${context.sha.slice(0, 7)}\`.`,
    '',
    `- Run: ${context.runUrl}`,
    `- Job: ${job.url}`,
    '',
  ];
  if (summary?.locations.length) {
    lines.push('**Where**', '');
    for (const l of summary.locations)
      lines.push(
        `- \`${l.file}${l.line ? `:${l.line}` : ''}\`${l.detail ? ` ${l.detail}` : ''}`
      );
    lines.push('');
  }
  if (summary?.command)
    lines.push('**Reproduce**', '', '```bash', summary.command, '```', '');
  const excerpt = summary?.excerpt || logTail;
  if (excerpt)
    lines.push(
      '<details><summary>Log excerpt</summary>',
      '',
      '```text',
      excerpt,
      '```',
      '',
      '</details>',
      ''
    );
  lines.push(
    '**To fix** (agents): branch from fresh `main`, reproduce, fix the cause (never weaken the check), run `bun run check`, and open a PR with `Fixes #<this issue>` in the body. This issue also closes itself when the job next passes on `main`. If it needs credentials, dashboards or a human decision, label it `needs-human` and say why.',
    '',
    '```json',
    JSON.stringify(
      {
        workflow: context.workflow,
        job: job.name,
        sha: context.sha,
        run: context.runUrl,
        job_url: job.url,
        command: summary?.command ?? '',
        locations: summary?.locations ?? [],
      },
      null,
      2
    ),
    '```',
    ''
  );
  return lines.join('\n');
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /;

/** Last lines of the failed steps, without the runner's timestamps. */
function failedLogTail(repo: string, job: Job, lines = 60): string {
  const result = Bun.spawnSync(
    [
      'gh',
      'run',
      'view',
      '-R',
      repo,
      '--job',
      String(job.databaseId),
      '--log-failed',
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  return result.stdout
    .toString()
    .split('\n')
    .map((line) => line.split('\t').slice(2).join('\t').replace(TIMESTAMP, ''))
    .filter(Boolean)
    .slice(-lines)
    .join('\n');
}

if (import.meta.main) {
  const repo = repository();
  const env = (name: string) => process.env[name] ?? '';
  const context: Context = {
    workflow: env('WORKFLOW'),
    sha: env('HEAD_SHA'),
    runUrl: env('RUN_URL'),
  };
  const jobs = ghJson<{ jobs: Job[] }>([
    'run',
    'view',
    env('RUN_ID'),
    '-R',
    repo,
    '--json',
    'jobs',
  ]).jobs;
  const summaries = readSummaries(env('SUMMARIES') || 'summaries');
  const open = new Map(
    ghJson<{ number: number; title: string }[]>([
      'issue',
      'list',
      '-R',
      repo,
      '--state',
      'open',
      '--label',
      LABELS[0],
      '--json',
      'number,title',
      '--limit',
      '200',
    ]).map((issue) => [issue.title, issue.number])
  );
  const { open: failing, close: passing } = plan(jobs);

  for (const job of failing) {
    const name = title(context.workflow, job.name);
    const summary = summaryFor(job, summaries);
    const body = renderBody(
      context,
      job,
      summary,
      summary?.excerpt ? '' : failedLogTail(repo, job)
    );
    const number = open.get(name);
    if (number) {
      gh(
        ['issue', 'edit', String(number), '-R', repo, '--body-file', '-'],
        body
      );
      gh(
        ['issue', 'comment', String(number), '-R', repo, '--body-file', '-'],
        `Still failing at \`${context.sha.slice(0, 7)}\`: ${job.url}`
      );
      console.log(`Updated #${number}: ${name}`);
    } else {
      gh(
        [
          'issue',
          'create',
          '-R',
          repo,
          '--title',
          name,
          ...LABELS.flatMap((label) => ['--label', label]),
          '--body-file',
          '-',
        ],
        body
      );
      console.log(`Opened: ${name}`);
    }
  }
  for (const job of passing) {
    const number = open.get(title(context.workflow, job.name));
    if (!number) continue;
    gh([
      'issue',
      'close',
      String(number),
      '-R',
      repo,
      '--comment',
      `Passing again at \`${context.sha.slice(0, 7)}\`: ${job.url}`,
    ]);
    console.log(`Closed #${number}`);
  }
}
