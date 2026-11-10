#!/usr/bin/env bun
/**
 * Snapshot every host the OpenTofu inventory serves into
 * `src/data/hosted-index.json`, which the unlisted `/hosted/` page renders.
 * The Docker build context is only `packages/portfolio`, so the site reads the
 * committed file; `src/data/hosted-index.test.ts` fails when it drifts.
 *
 * Usage (from packages/portfolio):
 *   bun run hosted-index           # rewrite the JSON from the inventory
 *   bun run hosted-index --check   # exit 1 when the committed JSON has drifted
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeLine } from '../src/library/cli-output';
import { MONOREPO_ROOT, isMonorepoPresent } from './verification/facts';
import {
  HOSTED_INDEX_RELATIVE_PATH,
  computeHostedIndex,
} from './verification/hosted-index';
import { formatJson, writeJson } from './verification/write-json';

const path = resolve(import.meta.dir, '..', HOSTED_INDEX_RELATIVE_PATH);

const main = async (): Promise<number> => {
  if (!isMonorepoPresent()) {
    writeLine(`Monorepo files are not present under ${MONOREPO_ROOT}.`);
    return 1;
  }
  const index = computeHostedIndex(MONOREPO_ROOT);
  if (process.argv.includes('--check')) {
    const expected = await formatJson(index, path);
    if (readFileSync(path, 'utf8') === expected) {
      writeLine('Hosted index matches the inventory.');
      return 0;
    }
    writeLine(
      `${HOSTED_INDEX_RELATIVE_PATH} has drifted; run \`bun run hosted-index\`.`
    );
    return 1;
  }
  const changed = await writeJson(index, path);
  writeLine(
    changed
      ? `Wrote ${HOSTED_INDEX_RELATIVE_PATH} (${String(index.hosts.length)} hosts).`
      : 'Hosted index already current.'
  );
  return 0;
};

process.exit(await main());
