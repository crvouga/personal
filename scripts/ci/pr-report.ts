/**
 * Keeps one sticky comment per PR with the latest result of each workflow
 * (CI, Guardrails): what failed, file:line, the repro command and a JSON block
 * agents can parse. On an agent PR, a third failing head commit (the first try
 * plus two retries) labels it `needs-human` and turns off auto-merge.
 *
 * Runs from ci-report.yml on `workflow_run`; failure summaries come from the
 * `ci-summary-*` artifacts written by .github/actions/failure-summary.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ghJson, repository } from './github';

export const MARKER = '<!-- ci-report -->';
export const MAX_FAILED_ATTEMPTS = 3;

export type Summary = {
  job: string;
  command: string;
  locations: { file: string; line: number; detail?: string }[];
  excerpt: string;
};
export type Run = {
  workflow: string;
  conclusion: string;
  sha: string;
  url: string;
  failedJobs: string[];
  summaries: Summary[];
};

const section = (workflow: string) =>
  new RegExp(
    `<!-- section:${workflow} -->[\\s\\S]*?<!-- /section:${workflow} -->\\n?`
  );

export function failedShas(body: string): string[] {
  const match = /<!-- failed-shas: ([^>]*) -->/.exec(body);
  return match ? match[1].split(',').filter(Boolean) : [];
}

export function renderSection(run: Run): string {
  const ok = run.conclusion === 'success';
  const icon = ok ? '✅' : run.conclusion === 'failure' ? '❌' : '⚪';
  const lines = [
    `<!-- section:${run.workflow} -->`,
    `### ${icon} ${run.workflow}: ${run.conclusion} on \`${run.sha.slice(0, 7)}\` ([run](${run.url}))`,
    '',
  ];
  for (const summary of run.summaries) {
    lines.push(`**${summary.job}**`, '');
    for (const l of summary.locations)
      lines.push(
        `- \`${l.file}${l.line ? `:${l.line}` : ''}\`${l.detail ? ` ${l.detail}` : ''}`
      );
    if (summary.command)
      lines.push('', 'Reproduce:', '```bash', summary.command, '```');
    lines.push('');
  }
  const unexplained = run.failedJobs.filter(
    (job) => !run.summaries.some((s) => job.startsWith(s.job))
  );
  if (!ok && unexplained.length)
    lines.push(
      `Also failed: ${unexplained.map((j) => `\`${j}\``).join(', ')}`,
      ''
    );
  if (!ok) {
    const machine = {
      workflow: run.workflow,
      sha: run.sha,
      conclusion: run.conclusion,
      run: run.url,
      failed_jobs: run.failedJobs,
      failures: run.summaries.map(({ job, command, locations }) => ({
        job,
        command,
        locations,
      })),
    };
    lines.push('```json', JSON.stringify(machine, null, 2), '```', '');
  }
  lines.push(`<!-- /section:${run.workflow} -->`);
  return lines.join('\n') + '\n';
}

export function renderComment(
  previous: string,
  run: Run
): { body: string; failures: string[] } {
  let failures = failedShas(previous);
  if (run.conclusion === 'failure' && !failures.includes(run.sha))
    failures = [...failures, run.sha];
  let sections = previous
    .replace(MARKER, '')
    .replace(/<!-- failed-shas: [^>]* -->\n?/, '')
    .replace(/^## CI report\n+/m, '')
    .replace(/^_Agents: [^\n]*\n+/m, '');
  sections = section(run.workflow).test(sections)
    ? sections.replace(section(run.workflow), renderSection(run))
    : `${sections.trimEnd()}\n\n${renderSection(run)}`;
  const body = [
    MARKER,
    `<!-- failed-shas: ${failures.join(',')} -->`,
    '## CI report',
    '',
    `_Agents: fix the failures below, run \`bun run check\`, and push. Failed attempts: ${failures.length}/${MAX_FAILED_ATTEMPTS} before \`needs-human\`._`,
    '',
    sections.trim(),
    '',
  ].join('\n');
  return { body, failures };
}

export function readSummaries(directory: string): Summary[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('summary.json'))
    .map(
      (file) =>
        JSON.parse(readFileSync(join(directory, file), 'utf8')) as Summary
    );
}

if (import.meta.main) {
  const repo = repository();
  const env = (name: string) => process.env[name] ?? '';
  let pr = env('PR_NUMBER');
  if (!pr) {
    const found = ghJson<{ number: number }[]>([
      'pr',
      'list',
      '-R',
      repo,
      '--head',
      env('HEAD_BRANCH'),
      '--state',
      'open',
      '--json',
      'number',
    ]);
    if (!found.length) {
      console.log('No open PR for this run');
      process.exit(0);
    }
    pr = String(found[0].number);
  }
  const jobs = ghJson<{ jobs: { name: string; conclusion: string }[] }>([
    'run',
    'view',
    env('RUN_ID'),
    '-R',
    repo,
    '--json',
    'jobs',
  ]).jobs;
  const run: Run = {
    workflow: env('WORKFLOW'),
    conclusion: env('CONCLUSION'),
    sha: env('HEAD_SHA'),
    url: env('RUN_URL'),
    failedJobs: jobs
      .filter((j) => j.conclusion === 'failure')
      .map((j) => j.name),
    summaries: readSummaries(env('SUMMARIES') || 'summaries'),
  };
  const comments = ghJson<{ id: number; body: string }[]>([
    'api',
    `repos/${repo}/issues/${pr}/comments`,
    '--paginate',
  ]);
  const existing = comments.find((c) => c.body.startsWith(MARKER));
  const { body, failures } = renderComment(existing?.body ?? '', run);
  if (existing)
    gh(
      [
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${existing.id}`,
        '-F',
        'body=@-',
      ],
      body
    );
  else gh(['pr', 'comment', pr, '-R', repo, '--body-file', '-'], body);

  const labels = ghJson<{ labels: { name: string }[] }>([
    'pr',
    'view',
    pr,
    '-R',
    repo,
    '--json',
    'labels',
  ]).labels.map((l) => l.name);
  if (
    run.conclusion === 'failure' &&
    labels.includes('agent-generated') &&
    !labels.includes('needs-human') &&
    failures.length >= MAX_FAILED_ATTEMPTS
  ) {
    gh(['pr', 'edit', pr, '-R', repo, '--add-label', 'needs-human']);
    // Labels added with GITHUB_TOKEN do not trigger Guardrails, so hold auto-merge here.
    Bun.spawnSync(['gh', 'pr', 'merge', pr, '-R', repo, '--disable-auto']);
    gh(
      ['pr', 'comment', pr, '-R', repo, '--body-file', '-'],
      `CI failed on ${failures.length} different commits. Labeled \`needs-human\` and turned off auto-merge.`
    );
  }
}
