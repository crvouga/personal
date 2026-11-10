/**
 * A deterministic `/index/` model for stories: the real snapshot and catalog,
 * with made-up probe results (no network) and art inlined, since Storybook
 * does not serve the site's `/index/art/` files.
 */
import { artSvg } from '../lib/service-art';
import { loadServiceIndex } from '../lib/service-index';
import {
  buildServiceIndexView,
  type ServiceIndexView,
  type ServiceItem,
} from '../lib/service-index-view';
import { STATUSES, type Probe } from '../lib/service-probe';

const snapshot = loadServiceIndex();

const fakeProbe = (index: number): Probe => {
  const status =
    STATUSES[index % 7 === 3 ? 3 : index % 5 === 1 ? 1 : 0] ?? 'live';
  return {
    status,
    httpStatus: status === 'down' ? 530 : 200,
    finalUrl: '',
    pageTitle: null,
    pageDescription: null,
    detail: status === 'down' ? 'HTTP 530' : 'HTTP 200',
  };
};

const view = buildServiceIndexView(
  snapshot,
  new Map(
    snapshot.hosts.map((host, index) => [host.hostname, fakeProbe(index)])
  ),
  '2026-01-01T12:00:00.000Z'
);

const inlineArt = (item: ServiceItem): ServiceItem => ({
  ...item,
  artHref: `data:image/svg+xml,${encodeURIComponent(artSvg(item.slug, item.title, item.category))}`,
});

export const SERVICE_INDEX_FIXTURE: ServiceIndexView = {
  ...view,
  sections: view.sections.map((section) => ({
    ...section,
    items: section.items.map(inlineArt),
  })),
  closed: view.closed.map(inlineArt),
};
