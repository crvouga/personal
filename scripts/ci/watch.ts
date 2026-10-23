/** Watch this checkout's CI run, including its called production deployment. */
import { execFileSync, spawnSync } from 'node:child_process';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
let run: { databaseId: number } | undefined;
for (let attempt = 0; attempt < 24; attempt++) {
  const runs = JSON.parse(
    execFileSync(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        'ci.yml',
        '--commit',
        sha,
        '--limit',
        '1',
        '--json',
        'databaseId',
      ],
      { encoding: 'utf8' }
    )
  );
  run = runs[0];
  if (run) break;
  console.log(`Waiting for CI at ${sha.slice(0, 7)}`);
  await Bun.sleep(5000);
}
if (!run)
  throw new Error(
    `No CI run found for ${sha}; publish this commit in a PR first`
  );
process.exit(
  spawnSync('gh', ['run', 'watch', String(run.databaseId), '--exit-status'], {
    stdio: 'inherit',
  }).status ?? 1
);
