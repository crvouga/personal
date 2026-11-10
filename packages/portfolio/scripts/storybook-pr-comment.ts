/**
 * Posts every Storybook screenshot on a pull request, for review.
 *
 *   bun run storybook:build
 *   bun run storybook:screenshots
 *   bun run storybook:pr-comment <pr-number> [--dry-run]
 *
 * The images are committed to an orphan `pr-assets/<pr>-storybook` branch
 * (review assets only: never merged, replaced on each run) and embedded from
 * raw.githubusercontent.com by commit SHA, so a comment always shows the run
 * it was posted for. Comments are split under GitHub's 65,536-character limit.
 */
import { $ } from 'bun';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SHOTS = join(ROOT, 'storybook-screenshots');
const REPO = 'crvouga/personal';
const LIMIT = 60_000;

const argv = process.argv.slice(2);
const pr = argv.find((arg) => /^\d+$/.test(arg));
const dryRun = argv.includes('--dry-run');
if (pr === undefined) {
  process.stderr.write('usage: storybook:pr-comment <pr-number> [--dry-run]\n');
  process.exit(2);
}

type Shot = { id: string; title: string; name: string; file: string };
const shots = JSON.parse(
  readFileSync(join(SHOTS, 'index.json'), 'utf8')
) as Shot[];
if (shots.length === 0)
  throw new Error('No screenshots: run storybook:screenshots first');

/** Commit the screenshots to the assets branch; returns the commit SHA. */
const publish = async (): Promise<string> => {
  const branch = `pr-assets/${pr}-storybook`;
  const dir = mkdtempSync(join(tmpdir(), 'storybook-pr-'));
  try {
    // A throwaway local branch: the assets branch lives only on the remote.
    const local = `storybook-pr-${String(process.pid)}`;
    await $`git worktree add --quiet --orphan -b ${local} ${dir}`.quiet();
    for (const file of readdirSync(SHOTS))
      cpSync(join(SHOTS, file), join(dir, file));
    await $`git -C ${dir} add -A`.quiet();
    await $`git -C ${dir} commit --quiet --no-verify -m ${`chore: Storybook screenshots for PR #${pr} (review assets, not source)`}`.quiet();
    if (!dryRun) {
      await $`git -C ${dir} push --quiet --force origin ${`HEAD:refs/heads/${branch}`}`.quiet();
    }
    return (await $`git -C ${dir} rev-parse HEAD`.text()).trim();
  } finally {
    await $`git worktree remove --force ${dir}`.quiet().nothrow();
    await $`git branch -D ${`storybook-pr-${String(process.pid)}`}`
      .quiet()
      .nothrow();
    rmSync(dir, { recursive: true, force: true });
  }
};

const sha = await publish();
const url = (file: string): string =>
  `https://raw.githubusercontent.com/${REPO}/${sha}/${file}`;
const img = (shot: Shot, width: number): string =>
  `<img src="${url(shot.file)}" width="${String(width)}" alt="${shot.title} — ${shot.name}">`;

const groups = new Map<string, Shot[]>();
for (const shot of shots)
  groups.set(shot.title, [...(groups.get(shot.title) ?? []), shot]);
const ORDER = [
  'Screens/Home',
  'Design system',
  'Screens',
  'Sections',
  'Components',
];
const rank = (title: string): number =>
  ORDER.findIndex((prefix) => title.startsWith(prefix));
const titles = [...groups.keys()].sort(
  (a, b) => rank(a) - rank(b) || a.localeCompare(b)
);

const table = (title: string): string =>
  ['| Variant | Screenshot |', '|---|---|']
    .concat(
      (groups.get(title) ?? []).map(
        (shot) => `| **${shot.name}** | ${img(shot, 420)} |`
      )
    )
    .join('\n');

const grid = (title: string): string => {
  const cells = (groups.get(title) ?? []).map(
    (shot) =>
      `<td align="center"><sub>${shot.name}</sub><br>${img(shot, 200)}</td>`
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 4)
    rows.push(`<tr>${cells.slice(i, i + 4).join('')}</tr>`);
  return `<details><summary><b>${title}</b> (${String(cells.length)})</summary>\n\n<table>${rows.join('')}</table>\n</details>\n`;
};

const head = [
  `## Storybook review: every archetype × every variation`,
  ``,
  `${String(shots.length)} stories from the static Storybook build at \`${sha.slice(0, 7)}\` (1280px wide, full page; \`phone\` stories at 390px). Each archetype renders in its own theme, in every colour scheme it shows. Click an image for full size. Regenerate: \`bun run storybook:build && bun run storybook:screenshots && bun run storybook:pr-comment ${pr}\`.`,
  ``,
  ...(groups.has('Screens/Home')
    ? [`### Home screen, by archetype`, ``, table('Screens/Home'), ``]
    : []),
  ...(groups.has('Design system/Theme')
    ? [`### Design system themes`, ``, table('Design system/Theme'), ``]
    : []),
  `### Every screen, section and component`,
  ``,
].join('\n');

const comments = [head];
for (const title of titles) {
  if (title === 'Screens/Home' || title === 'Design system/Theme') continue;
  const block = grid(title);
  if ((comments.at(-1) ?? '').length + block.length > LIMIT) {
    comments.push('### Every screen, section and component (continued)\n\n');
  }
  comments[comments.length - 1] += block;
}

for (const body of comments) {
  if (dryRun)
    process.stdout.write(
      `--- ${String(body.length)} chars ---\n${body.slice(0, 400)}\n`
    );
  else {
    const posted =
      await $`gh pr comment ${pr} --repo ${REPO} --body-file - < ${Buffer.from(body)}`.text();
    process.stdout.write(`${posted.trim()}\n`);
  }
}
