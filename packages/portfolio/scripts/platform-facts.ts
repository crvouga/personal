#!/usr/bin/env bun
/**
 * Compute platform facts from this monorepo and write
 * `src/data/platform-facts.json`.
 *
 * The site cannot compute these at build time — the Docker build context is
 * only `packages/portfolio` — so it renders the committed file, and the drift
 * test (`src/data/platform-facts.test.ts`) recomputes it whenever the monorepo
 * is present. The file carries no timestamp, so regenerating unchanged facts
 * is a no-op diff; the AI-trailer count is pinned to the commit it was taken
 * at for the same reason.
 *
 * Usage (from packages/portfolio):
 *   bun run facts            # rewrite the JSON from HEAD
 *   bun run facts --check    # exit 1 when the committed JSON has drifted
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlatformFacts } from '../src/lib/platform-facts';
import { writeLine } from '../src/library/cli-output';
import {
  FACTS_RELATIVE_PATH,
  MONOREPO_ROOT,
  computePlatformFacts,
  isMonorepoPresent,
  recomputeForCheck,
  serializeFacts,
} from './verification/facts';
import { writeJson } from './verification/write-json';

const factsPath = resolve(import.meta.dir, '..', FACTS_RELATIVE_PATH);

const readRaw = (): string => {
  try {
    return readFileSync(factsPath, 'utf8');
  } catch {
    return '';
  }
};

/** Lets a CI step decide whether there is anything to commit. */
const emitChanged = (changed: boolean): void => {
  const output = process.env['GITHUB_OUTPUT'];
  if (output === undefined || output === '') return;
  appendFileSync(output, `facts_changed=${String(changed)}\n`, 'utf8');
};

const write = async (): Promise<number> => {
  const changed = await writeJson(computePlatformFacts(), factsPath);
  writeLine(
    changed ? `Wrote ${FACTS_RELATIVE_PATH}.` : 'Facts already current.'
  );
  emitChanged(changed);
  return 0;
};

const check = (): number => {
  const raw = readRaw();
  if (raw === '') {
    writeLine(`No facts at ${factsPath}; run \`bun run facts\`.`);
    return 1;
  }
  const committed = parsePlatformFacts(JSON.parse(raw));
  const { recomputed, historySkipped } = recomputeForCheck(committed);
  if (historySkipped !== null) {
    writeLine(`AI trailer counts not re-verified: ${historySkipped}.`);
  }
  if (serializeFacts(recomputed) === serializeFacts(committed)) {
    writeLine('Platform facts match the repository.');
    return 0;
  }
  writeLine(`${FACTS_RELATIVE_PATH} has drifted; run \`bun run facts\`.`);
  writeLine(serializeFacts(recomputed));
  return 1;
};

const main = async (): Promise<void> => {
  if (!isMonorepoPresent()) {
    writeLine(`Monorepo files are not present under ${MONOREPO_ROOT}.`);
    process.exit(1);
  }
  process.exit(process.argv.includes('--check') ? check() : await write());
};

await main();
