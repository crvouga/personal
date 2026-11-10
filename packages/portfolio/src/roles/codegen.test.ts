import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import { VARIANT_NAMES } from '../stories/variants';
import {
  formattedExpectedFiles,
  orphanedFiles,
  relativeToSrc,
  withVariants,
  START,
  END,
} from './codegen';

describe('files generated from the role files', () => {
  test('are up to date: run bun run roles:sync', async () => {
    const stale = [...(await formattedExpectedFiles(VARIANT_NAMES))]
      .filter(
        ([path, content]) =>
          !existsSync(path) || readFileSync(path, 'utf8') !== content
      )
      .map(([path]) => relativeToSrc(path));
    expect(stale).toEqual([]);
    expect(orphanedFiles().map(relativeToSrc)).toEqual([]);
  });

  test('a story file keeps everything outside its generated block', () => {
    const source = `before\n${START}\nold\n${END}\nafter`;
    const out = withVariants(source, ['A', 'B']);
    expect(out.startsWith('before\n')).toBe(true);
    expect(out.endsWith('\nafter')).toBe(true);
    expect(out).toContain("export const B = variant('B');");
    expect(out).not.toContain('old');
  });
});
