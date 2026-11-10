/**
 * Cover art for every `/index/` item, one file each so the page itself stays
 * small and the images load lazily.
 */
import { artSvg } from '../../../lib/service-art';
import { loadServiceIndex } from '../../../lib/service-index';
import { buildServiceIndexView } from '../../../lib/service-index-view';

export const getStaticPaths = () => {
  const view = buildServiceIndexView(loadServiceIndex(), null, null);
  return [
    ...view.sections.flatMap((section) => section.items),
    ...view.closed,
  ].map((item) => ({
    params: { slug: item.slug },
    props: { svg: artSvg(item.slug, item.title, item.category) },
  }));
};

export const GET = ({ props }: { props: { svg: string } }): Response =>
  new Response(props.svg, { headers: { 'content-type': 'image/svg+xml' } });
