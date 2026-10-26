import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Nothing half-finished deploys. A fact that must be supplied before launch is
 * written as `{{NEEDS_INPUT: …}}` (see CONTENT_QUESTIONS.md); while one remains
 * in the registry or in a built page, this fails, and so does the build that
 * runs it.
 */

const MARKER = '{{NEEDS_INPUT';
const PACKAGE_ROOT = resolve(import.meta.dir, '../..');
const SCANNED = ['src/content', 'src/pages', 'src/components', 'src/resume'];
const TEXT_FILE = /\.(ts|astro|md|mdx|json|html|txt|xml)$/;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return TEXT_FILE.test(name) ? [path] : [];
  });

const withMarker = (dir: string): string[] =>
  existsSync(dir)
    ? filesUnder(dir)
        .filter((path) => !path.endsWith('needs-input.test.ts'))
        .filter((path) => readFileSync(path, 'utf8').includes(MARKER))
        .map((path) => relative(PACKAGE_ROOT, path))
    : [];

describe('no unanswered placeholders', () => {
  test('in the content registry and the components that render it', () => {
    const found = SCANNED.flatMap((dir) => withMarker(join(PACKAGE_ROOT, dir)));
    expect(found).toEqual([]);
  });

  // `dist/` exists after a build; CI runs the tests after building, so a
  // placeholder that slipped through a component still fails here.
  test('in the built site, when there is one', () => {
    expect(withMarker(join(PACKAGE_ROOT, 'dist'))).toEqual([]);
  });
});
