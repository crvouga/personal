import { getCollection, type CollectionEntry } from 'astro:content';

import type { PostFrontmatter } from './writing';

type Entry = CollectionEntry<'writing'>;

/** A post as the pages use it: typed and checked once, here. */
export type Post = {
  readonly id: string;
  readonly data: PostFrontmatter;
  readonly entry: Entry;
};

const toPost = (entry: Entry): Post => {
  const id: unknown = entry.id;
  const data: unknown = entry.data;
  if (typeof id !== 'string' || typeof data !== 'object' || data === null) {
    throw new Error('writing collection returned an unexpected entry');
  }
  // The collection schema (src/content.config.ts) has validated `data`.
  return { id, data: data as PostFrontmatter, entry };
};

const isPublished = (entry: Entry): boolean => !toPost(entry).data.draft;

/** Published posts, newest first. Drafts never reach a page, a feed or the nav. */
export const publishedPosts = async (): Promise<Post[]> => {
  const entries: Entry[] = await getCollection('writing', isPublished);
  return entries
    .map(toPost)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
};

export const postHref = (post: Post): string => `/writing/${post.id}/`;
