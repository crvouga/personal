#!/usr/bin/env bun
/**
 * Writes `generated/github-profile-README.md` (for Chris to commit as the
 * README of `crvouga/crvouga`) and `CONSISTENCY_CHECKLIST.md` (what LinkedIn
 * must mirror) from the content registry. Nothing here touches
 * GitHub. `src/lib/candidate.test.ts` fails when the committed file drifts.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildConsistencyChecklist,
  buildProfileReadme,
} from '../src/lib/candidate';
import { writeLine } from '../src/library/cli-output';

export const PROFILE_README_PATH = resolve(
  import.meta.dir,
  '../generated/github-profile-README.md'
);
export const CONSISTENCY_CHECKLIST_PATH = resolve(
  import.meta.dir,
  '../CONSISTENCY_CHECKLIST.md'
);

if (import.meta.main) {
  writeFileSync(PROFILE_README_PATH, buildProfileReadme(), 'utf8');
  writeLine(`wrote ${PROFILE_README_PATH}`);
  writeFileSync(
    CONSISTENCY_CHECKLIST_PATH,
    buildConsistencyChecklist(),
    'utf8'
  );
  writeLine(`wrote ${CONSISTENCY_CHECKLIST_PATH}`);
}
