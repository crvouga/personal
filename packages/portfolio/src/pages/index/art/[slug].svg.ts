/**
 * Cover art for every `/index/` card, one file per host so the page itself
 * stays small and the images load lazily.
 */
import { CATALOG } from '../../../content/service-index';
import { artSvg } from '../../../lib/service-art';
import { loadServiceIndex } from '../../../lib/service-index';
import { catalogEntryFor, slugOf } from '../../../lib/service-index-view';

export const getStaticPaths = () =>
  loadServiceIndex().hosts.map((host) => {
    const entry = CATALOG[host.hostname] ?? catalogEntryFor(host);
    return {
      params: { slug: slugOf(host.hostname) },
      props: { svg: artSvg(host.hostname, entry.title, entry.category) },
    };
  });

export const GET = ({ props }: { props: { svg: string } }): Response =>
  new Response(props.svg, { headers: { 'content-type': 'image/svg+xml' } });
