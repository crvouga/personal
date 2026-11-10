#!/usr/bin/env bun
/**
 * Brings every file generated from the role files up to date: the
 * role files and research indexes, each role's details story, and the
 * variant exports in every story file. Run after adding, renaming or
 * removing a role file or a market research.
 *
 * Usage (from packages/portfolio): bun run roles:sync
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROLE_FILES_DIR,
  RESEARCH_DIR,
  roleFileIds,
  formattedExpectedFiles,
  orphanedFiles,
  relativeToSrc,
  variantNamesFor,
} from '../src/roles/codegen';
import type { RoleSpec } from '../src/roles/define';
import { writeLine } from '../src/library/cli-output';
import { visualStyleOf } from '../src/roles/style';
import { ResearchSchema } from '../src/market/schema';

const write = (path: string, content: string): void => {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) return;
  writeFileSync(path, content);
  writeLine(`  wrote ${relativeToSrc(path)}`);
};

// The indexes first: everything else imports the role files through them.
const indexes = await formattedExpectedFiles([]);
for (const [path, content] of indexes) {
  if (path.endsWith('index.ts')) write(path, content);
}

const specs = await Promise.all(
  roleFileIds().map(
    async (id) =>
      (
        (await import(join(ROLE_FILES_DIR, `${id}.ts`))) as {
          default: RoleSpec;
        }
      ).default
  )
);
const schemeOf = (id: string): 'auto' | 'light' => {
  const spec = specs.find((candidate) => candidate.id === id);
  const research = ResearchSchema.parse(
    JSON.parse(readFileSync(join(RESEARCH_DIR, `${id}.json`), 'utf8'))
  );
  return visualStyleOf(research.visual, spec?.style).scheme;
};
const names = variantNamesFor(specs, schemeOf);

for (const [path, content] of await formattedExpectedFiles(names)) {
  write(path, content);
}
for (const path of orphanedFiles()) {
  rmSync(path);
  writeLine(`  removed ${relativeToSrc(path)}`);
}
writeLine(
  `${String(specs.length)} roles, ${String(names.length)} story variants`
);
