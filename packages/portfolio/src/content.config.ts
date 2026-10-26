/**
 * Content collections. Only the writing lives here; the rest of the site's
 * content is the typed TypeScript registry under src/content/.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const writing = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(160),
    /** Drafts are written from repository artifacts and wait for Chris. */
    draft: z.boolean(),
    date: z.coerce.date(),
    /** Claims Chris must check before publishing; must be empty to publish. */
    verify: z.array(z.string()).default([]),
  }),
});

export const collections = { writing };
