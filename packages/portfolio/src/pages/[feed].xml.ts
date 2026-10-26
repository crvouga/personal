/**
 * RSS for published posts at `/rss.xml`. Like `/writing/`, it is generated only
 * once a post is published. Written by hand: an RSS 2.0 feed is a few lines and
 * does not justify a dependency.
 */
import { CONTENT } from '../content/content';
import { postHref, publishedPosts, type Post } from '../lib/published-posts';

export const getStaticPaths = async () =>
  (await publishedPosts()).length > 0 ? [{ params: { feed: 'rss' } }] : [];

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const item = (post: Post): string => {
  const url = `${CONTENT.SITE_URL}${postHref(post)}`;
  return `<item><title>${escape(post.data.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${post.data.date.toUTCString()}</pubDate><description>${escape(post.data.description)}</description></item>`;
};

export const GET = async (): Promise<Response> => {
  const posts = await publishedPosts();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${escape(CONTENT.PAGE_TITLE)} — Writing</title><link>${CONTENT.SITE_URL}/writing/</link><description>Writing by ${escape(CONTENT.PAGE_TITLE)}</description><language>en</language>${posts.map(item).join('')}</channel></rss>
`;
  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
};
