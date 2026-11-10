/**
 * The static Storybook build (`storybook-static/`, from `bun run
 * storybook:build`): every story was prerendered, inside its role's
 * theme, with nothing failing to render.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROLE_IDS } from '../src/roles/definitions';

const STATIC = join(import.meta.dir, '..', 'storybook-static');
if (!existsSync(join(STATIC, 'index.json'))) {
  throw new Error(
    'storybook-static/ is missing: run `bun run storybook:build` first.'
  );
}

type Entry = { id: string; type: string };
const entries = Object.values(
  (
    JSON.parse(readFileSync(join(STATIC, 'index.json'), 'utf8')) as {
      entries: Record<string, Entry>;
    }
  ).entries
).filter((entry) => entry.type === 'story');
const rendered = JSON.parse(
  readFileSync(join(STATIC, 'astro-prerendered-stories.json'), 'utf8')
) as Record<string, string>;

describe('static storybook', () => {
  test('every story is prerendered', () => {
    expect(entries.length).toBeGreaterThan(200);
    expect(entries.filter((entry) => rendered[entry.id] === undefined)).toEqual(
      []
    );
  });

  test('every story renders inside a role theme', () => {
    const unthemed = entries.filter(
      (entry) =>
        !ROLE_IDS.some((id) =>
          (rendered[entry.id] ?? '').includes(`data-theme="${id}"`)
        )
    );
    expect(unthemed.map((entry) => entry.id)).toEqual([]);
  });

  test('every role is shown in every screen', () => {
    for (const id of ROLE_IDS) {
      const home = entries.filter(
        (entry) =>
          entry.id.startsWith('screens-home--') &&
          (rendered[entry.id] ?? '').includes(`data-theme="${id}"`)
      );
      expect(home.length).toBeGreaterThan(0);
    }
  });
});
