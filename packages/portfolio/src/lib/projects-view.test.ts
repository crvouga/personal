import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ARCHIVE_PROJECTS, PROJECTS } from '../content/project';
import { VISIBLE_PROJECTS } from './projects-view';

describe('project registry', () => {
  test('homepage projects lead with the strongest hiring evidence', () => {
    expect(VISIBLE_PROJECTS.map((project) => project.id)).toEqual([
      'mockingbird',
      'gamezilla',
      'workspace-platform',
    ]);
    expect(
      PROJECTS.some((project) => project.id === 'infra-control-plane')
    ).toBe(false);
  });

  // Nothing else enforces this, and a `new Map` keyed by id would silently
  // keep the last duplicate.
  test('project ids are unique across the registry and the archive', () => {
    const ids = [...PROJECTS, ...ARCHIVE_PROJECTS].map((p) => p.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  // The archive is the "everything else" fold on /projects/: it must stay out
  // of the curated listing, or it would dilute the page it is folded under.
  test('the archive is disjoint from the listed projects', () => {
    const listed = new Set(PROJECTS.map((p) => p.id));
    expect(ARCHIVE_PROJECTS.filter((p) => listed.has(p.id))).toEqual([]);
    expect(ARCHIVE_PROJECTS.length).toBeGreaterThan(0);
  });

  test('every archive project still renders an image it ships', () => {
    const missing = ARCHIVE_PROJECTS.flatMap((p) =>
      [...p.imageSrc, ...p.galleryImageSrc].filter((src) => src.startsWith('/'))
    ).filter(
      (src) => !existsSync(join(import.meta.dir, '..', '..', 'public', src))
    );
    expect(missing).toEqual([]);
  });
});
