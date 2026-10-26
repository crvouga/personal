import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { publicationBlockers, type PostFrontmatter } from './writing';

const DIR = join(import.meta.dir, '../content/writing');

/** Minimal frontmatter reader; the collection schema validates the real thing. */
const parse = (file: string): { data: PostFrontmatter; body: string } => {
  const raw = readFileSync(join(DIR, file), 'utf8');
  const [, front = '', body = ''] =
    /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw) ?? [];
  const field = (key: string): string =>
    (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1] ?? '').replace(
      /^['"]|['"]$/g,
      ''
    );
  const verify = /^verify:\n((?:\s+- .*\n?)*)/m.exec(front)?.[1] ?? '';
  return {
    data: {
      title: field('title'),
      description: field('description'),
      draft: field('draft') === 'true',
      date: new Date(field('date')),
      verify: verify.split('\n').filter((line) => line.trim().startsWith('- ')),
    },
    body,
  };
};

const posts = readdirSync(DIR).filter((file) => file.endsWith('.md'));

describe('writing', () => {
  test('every post has a title, a description and a date', () => {
    for (const file of posts) {
      const { data } = parse(file);
      expect(data.title.length).toBeGreaterThan(0);
      expect(data.description.length).toBeGreaterThan(0);
      expect(data.description.length).toBeLessThanOrEqual(160);
      expect(Number.isNaN(data.date.getTime())).toBe(false);
    }
  });

  // A post goes live only when every claim has been checked by Chris.
  test('a published post has no unchecked claims and the right length', () => {
    const blocked = posts
      .map((file) => ({ file, ...parse(file) }))
      .filter(({ data }) => !data.draft)
      .flatMap(({ file, data, body }) =>
        publicationBlockers(data, body).map((reason) => `${file}: ${reason}`)
      );
    expect(blocked).toEqual([]);
  });

  test('a draft names what must be verified, so it cannot be published by accident', () => {
    const silent = posts
      .map((file) => ({ file, ...parse(file) }))
      .filter(
        ({ data, body }) =>
          data.draft && publicationBlockers(data, body).length === 0
      )
      .map(({ file }) => file);
    // A draft with nothing left to verify should simply be published.
    expect(silent).toEqual([]);
  });
});
