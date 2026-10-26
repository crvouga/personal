/**
 * Publication rules for posts, shared by the pages, the RSS feed and the
 * nav. A post is published only when `draft: false`, its `verify:` list is
 * empty and no `[[VERIFY: …]]` marker remains — writing.test.ts enforces it.
 */
export const VERIFY_MARKER = '[[VERIFY';
export const MIN_POST_WORDS = 800;
export const MAX_POST_WORDS = 1200;

export type PostFrontmatter = {
  readonly title: string;
  readonly description: string;
  readonly draft: boolean;
  readonly date: Date;
  readonly verify: readonly string[];
};

export const wordCount = (markdown: string): number =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\s+/)
    .filter((word) => /\w/.test(word)).length;

/** Why a post may not be published yet; empty when it is ready. */
export const publicationBlockers = (
  data: PostFrontmatter,
  body: string
): string[] => {
  const words = wordCount(body);
  return [
    data.verify.length > 0
      ? `${String(data.verify.length)} unchecked verify: entries`
      : null,
    body.includes(VERIFY_MARKER) ? 'a [[VERIFY]] marker in the body' : null,
    words < MIN_POST_WORDS || words > MAX_POST_WORDS
      ? `${String(words)} words (expected ${String(MIN_POST_WORDS)}–${String(MAX_POST_WORDS)})`
      : null,
  ].filter((reason): reason is string => reason !== null);
};
