/**
 * One share card per case study and per published post, so a link previews
 * the page rather than the homepage. Same renderer and overflow check as
 * `/og.png`: text that outgrows the card fails the build.
 */
import { CASE_STUDIES } from '../../content/case-studies';
import { publishedPosts } from '../../lib/published-posts';
import { buildCaseStudyCardContent, type CardContent } from '../../social/card';
import { renderCardPng } from '../../social/render';

export const getStaticPaths = async () => [
  ...CASE_STUDIES.map((study) => ({
    params: { slug: study.slug },
    props: { card: buildCaseStudyCardContent(study) },
  })),
  ...(await publishedPosts()).map((post) => ({
    params: { slug: `writing-${post.id}` },
    props: {
      card: {
        ...buildCaseStudyCardContent({
          title: post.data.title,
          subline: post.data.description,
        }),
        eyebrow: '// writing',
      },
    },
  })),
];

export const GET = async ({
  props,
}: {
  props: { card: CardContent };
}): Promise<Response> =>
  new Response(Buffer.from(await renderCardPng(props.card)), {
    headers: { 'content-type': 'image/png' },
  });
