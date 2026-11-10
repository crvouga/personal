import { describe, expect, test } from 'bun:test';
import { artSvg, hash, monogram } from './service-art';
import { relativeTime, matches } from './service-index-client';
import type { ServiceIndexSnapshot } from './service-index';
import { buildServiceIndexView, slugOf } from './service-index-view';
import type { Probe, Status } from './service-probe';

const snapshot: ServiceIndexSnapshot = {
  version: 2,
  zone: 'chrisvouga.dev',
  hosts: ['snake', 'vault', 'dozzle', 'pickflix', 'auth', 'auth-dev'].map(
    (name) => ({
      hostname: `${name}.chrisvouga.dev`,
      url: `https://${name}.chrisvouga.dev/`,
      id: name,
      hosting: 'railway',
      sourceUrl: null,
    })
  ),
  resources: [
    {
      key: 'postgres:openbao',
      kind: 'postgres',
      id: 'openbao',
      name: 'crvouga/personal · main',
      provider: 'PlanetScale',
      consoleUrl: 'https://app.planetscale.com/crvouga/personal',
    },
  ],
};

const probed = (status: Status): Probe => ({
  status,
  httpStatus: 200,
  finalUrl: '',
  pageTitle: null,
  pageDescription: null,
  detail: status,
});

describe('buildServiceIndexView', () => {
  const view = buildServiceIndexView(
    snapshot,
    new Map([
      ['snake.chrisvouga.dev', probed('live')],
      ['vault.chrisvouga.dev', probed('gated')],
      ['dozzle.chrisvouga.dev', probed('down')],
      ['pickflix.chrisvouga.dev', probed('parked')],
      ['auth.chrisvouga.dev', probed('down')],
      ['auth-dev.chrisvouga.dev', probed('live')],
    ]),
    '2026-01-01T00:00:00.000Z'
  );
  const titles = (category: string): readonly string[] =>
    view.sections
      .find((section) => section.category === category)
      ?.items.map((item) => item.title) ?? [];

  test('items are grouped into sections, in catalog order', () => {
    expect(view.sections.map((section) => section.category)).toEqual([
      'public-app',
      'public-api',
      'internal-api',
      'postgres',
    ]);
    expect(titles('public-app')).toEqual(['Snake']);
  });

  test('variants of one thing are one item, each a link of its own', () => {
    const relay = view.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === 'Relay');
    expect(relay?.variants.map((variant) => variant.label)).toEqual([
      'Production',
      'Dev',
    ]);
    expect(relay?.variants.map((variant) => variant.isLink)).toEqual([
      false,
      true,
    ]);
    expect(relay?.status).toBe('live');
    expect(relay?.url).toBe('https://auth-dev.chrisvouga.dev/');
  });

  test('items with no working link leave the sections', () => {
    expect(view.closed.map((item) => item.title).sort()).toEqual([
      'Dozzle',
      'Pickflix',
    ]);
    expect(view.counts).toEqual({
      live: 2,
      gated: 1,
      parked: 1,
      down: 2,
      unchecked: 0,
      console: 1,
    });
  });

  test('stores link to their console without a probe', () => {
    const [postgres] = titles('postgres');
    expect(postgres).toBe('Personal Postgres');
  });

  test('without probes every host is unchecked, not offline', () => {
    const unchecked = buildServiceIndexView(
      snapshot,
      null,
      '2026-01-01T00:00:00.000Z'
    );
    expect(unchecked.checkedAt).toBeNull();
    expect(unchecked.closed).toEqual([]);
    expect(unchecked.counts.unchecked).toBe(6);
  });

  test('slugs are file-safe and never collide', () => {
    expect(slugOf('svelte.headlesscombobox.chrisvouga.dev')).not.toBe(
      slugOf('svelte-headlesscombobox.chrisvouga.dev')
    );
    expect(slugOf('A_b.dev')).toBe('a-b.dev');
  });
});

describe('art', () => {
  test('is deterministic per host and differs between hosts', () => {
    expect(artSvg('a.dev', 'A', 'public-app')).toBe(
      artSvg('a.dev', 'A', 'public-app')
    );
    expect(artSvg('a.dev', 'A', 'public-app')).not.toBe(
      artSvg('b.dev', 'A', 'public-app')
    );
    expect(hash('a')).not.toBe(hash('b'));
  });

  test('escapes the title and draws a two-letter monogram', () => {
    expect(artSvg('a.dev', '<x>', 'internal-api')).not.toContain('<x>');
    expect(monogram('Connect Four')).toBe('CF');
    expect(monogram('vLLM')).toBe('VL');
    expect(monogram("Violet's Garden")).toBe('VG');
  });
});

describe('client helpers', () => {
  test('search needs every word, in any order', () => {
    expect(matches('snake game classic', 'game snake')).toBe(true);
    expect(matches('snake game classic', 'snake chess')).toBe(false);
    expect(matches('anything', '  ')).toBe(true);
  });

  test('check time reads relative', () => {
    const now = Date.parse('2026-01-01T03:00:00Z');
    expect(relativeTime('2026-01-01T00:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('not a date', now)).toBeNull();
  });
});
