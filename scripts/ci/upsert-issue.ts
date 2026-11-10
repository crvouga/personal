/**
 * Keeps exactly one open issue per title: comments on it when it exists,
 * opens it otherwise, and `--close` closes it once the condition clears.
 *
 *   bun scripts/ci/upsert-issue.ts --title T --label L (--body B | --body-file F) [--close]
 */
import { readFileSync } from 'node:fs';
import { flag, gh, ghJson, repository } from './github';

const MAX_BODY = 60_000;

export function truncate(body: string): string {
  return body.length <= MAX_BODY
    ? body
    : `${body.slice(0, MAX_BODY)}\n\n… truncated; see the workflow run for the full output.`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const title = flag(argv, 'title');
  const label = flag(argv, 'label');
  const bodyFile = flag(argv, 'body-file');
  const body = truncate(
    bodyFile ? readFileSync(bodyFile, 'utf8') : (flag(argv, 'body') ?? '')
  );
  if (!title || !label) throw new Error('--title and --label are required');
  const repo = repository();
  const open = ghJson<{ number: number; title: string }[]>([
    'issue',
    'list',
    '-R',
    repo,
    '--state',
    'open',
    '--label',
    label,
    '--json',
    'number,title',
    '--limit',
    '100',
  ]).find((issue) => issue.title === title);

  if (argv.includes('--close')) {
    if (open) {
      gh([
        'issue',
        'close',
        String(open.number),
        '-R',
        repo,
        '--comment',
        body || 'Resolved.',
      ]);
      console.log(`Closed #${open.number}`);
    } else console.log('Nothing to close');
  } else if (open) {
    gh(
      ['issue', 'comment', String(open.number), '-R', repo, '--body-file', '-'],
      body
    );
    console.log(`Updated #${open.number}`);
  } else {
    gh(
      [
        'issue',
        'create',
        '-R',
        repo,
        '--title',
        title,
        '--label',
        label,
        '--body-file',
        '-',
      ],
      body
    );
    console.log(`Opened issue: ${title}`);
  }
}
