// Turns the failing step recorded by logged-shell.sh into a short report:
// what failed, file:line locations and the command to reproduce it. Writes
// Markdown to $GITHUB_STEP_SUMMARY and JSON for the sticky PR comment.
// Plain JavaScript so it runs on any runner without installing dependencies.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const LOCATION =
  /((?:[\w.@-]+\/)*[\w.@-]+\.(?:[cm]?[jt]sx?|json|ya?ml|tf|tftest\.hcl|hcl|py|md|astro|css|sh|toml))(?::|\(|", line )(\d+)(?:[:,](\d+))?/g;

export function lastStep(log) {
  const blocks = log.split('\n::ci-step::\n').slice(1);
  const block = blocks.at(-1);
  if (!block) return null;
  const [command, output = ''] = block.split('\n::ci-output::\n');
  return { command: command.trim(), output: output.replace(ANSI, '') };
}

export function locations(output, limit = 10) {
  const seen = new Map();
  for (const match of output.matchAll(LOCATION)) {
    const file = match[1].replace(/^\.\//, '');
    if (file.includes('node_modules/') || file.startsWith('/')) continue;
    const key = `${file}:${match[2]}`;
    if (!seen.has(key)) seen.set(key, { file, line: Number(match[2]) });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export function summarize({ job, log }) {
  const step = lastStep(log);
  const excerpt = step
    ? step.output.trimEnd().split('\n').slice(-40).join('\n')
    : '';
  return {
    job,
    command: step?.command ?? '',
    locations: step ? locations(step.output) : [],
    excerpt,
  };
}

export function markdown(summary) {
  const lines = [`### ❌ ${summary.job} failed`, ''];
  if (summary.locations.length) {
    lines.push('**Where**', '');
    for (const l of summary.locations) lines.push(`- \`${l.file}:${l.line}\``);
    lines.push('');
  }
  if (summary.command)
    lines.push(
      '**Reproduce locally**',
      '',
      '```bash',
      summary.command,
      '```',
      ''
    );
  if (summary.excerpt)
    lines.push(
      '<details><summary>Last 40 log lines</summary>',
      '',
      '```text',
      summary.excerpt,
      '```',
      '',
      '</details>'
    );
  return lines.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const temp = process.env.RUNNER_TEMP ?? '/tmp';
  const directory = join(temp, 'ci-summary');
  const output = join(directory, 'summary.json');
  mkdirSync(directory, { recursive: true });
  // A job that already wrote a precise summary (protected-paths) keeps it.
  if (!existsSync(output)) {
    const logPath = join(temp, 'ci-steps.log');
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const summary = summarize({ job: process.env.JOB_NAME ?? 'job', log });
    writeFileSync(output, JSON.stringify(summary, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(summary));
  }
}
