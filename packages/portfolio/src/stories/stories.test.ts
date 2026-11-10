import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { VARIANTS } from './variants';

/**
 * Storybook is where UI is built, so it must stay comprehensive: every
 * component and screen has stories, and every story file covers every
 * archetype in every colour scheme its theme shows.
 */
const SRC = join(import.meta.dir, '..');

const filesIn = (dir: string, suffix: string): string[] =>
  readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name), suffix)
      : entry.name.endsWith(suffix)
        ? [join(dir, entry.name)]
        : []
  );

const STORY_FILES = [
  'components',
  'screens',
  'stories',
  'design-system',
].flatMap((dir) => filesIn(dir, '.stories.ts'));
const STORIES = STORY_FILES.map((file) =>
  readFileSync(join(SRC, file), 'utf8')
);

describe('storybook', () => {
  test('every story file exports every archetype × scheme variant', () => {
    const missing = STORY_FILES.flatMap((file, index) =>
      Object.keys(VARIANTS)
        .filter(
          (name) =>
            !(STORIES[index] ?? '').includes(
              `export const ${name} = VARIANTS.${name};`
            )
        )
        .map((name) => `${file}: ${name}`)
    );
    expect(missing).toEqual([]);
  });

  test('every component and screen has a story', () => {
    const rendered = new Set(
      STORIES.flatMap((source) =>
        [
          ...source.matchAll(
            /import \w+ from '\.\.?\/(?:[\w-]+\/)*([\w-]+)\.astro';/g
          ),
        ].map((match) => match[1])
      )
    );
    // Rendered inside a story wrapper (src/stories/*Demo.astro), or a frame.
    const indirect: Readonly<Record<string, string>> = {
      ContributionCalendar: 'ContributionDemo',
      ContributionHeatmap: 'ContributionDemo',
      GalleryDialog: 'GalleryDemo',
    };
    const components = [
      ...filesIn('components', '.astro'),
      ...filesIn('screens', '.astro'),
    ]
      .filter((file) => !relative('components', file).startsWith('icons'))
      .map((file) => basename(file, '.astro'));
    const unstoried = components.filter(
      (name) => !rendered.has(name) && !rendered.has(indirect[name] ?? '')
    );
    // Writing has no published post, and Storybook has no content collection.
    expect(unstoried.sort()).toEqual([
      'WritingIndexScreen',
      'WritingPostScreen',
    ]);
  });
});
