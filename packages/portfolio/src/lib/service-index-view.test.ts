import { describe, expect, test } from 'bun:test';
import { artSvg, hash, monogram } from './service-art';
import { relativeTime, matches } from './service-index-client';
import type { ServiceIndexSnapshot } from './service-index';
import { buildServiceIndexView, slugOf } from './service-index-view';
import type { Probe, Status } from './service-probe';

const snapshot: ServiceIndexSnapshot = {
  version: 1,
  zone: 'chrisvouga.dev',
  hosts: ['snake', 'vault', 'dozzle', 'pickflix'].map((name) => ({
    hostname: `${name}.chrisvouga.dev`,
    url: `https://${name}.chrisvouga.dev/`,
    id: name,
    hosting: 'railway',
    sourceUrl: null,
  })),
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
    ]),
    '2026-01-01T00:00:00.000Z'
  );

  test('offline and parked hosts leave the working grid', () => {
    expect(view.open.map((card) => card.hostname)).toEqual([
      'snake.chrisvouga.dev',
      'vault.chrisvouga.dev',
    ]);
    expect(view.closed.map((card) => card.status).sort()).toEqual([
      'down',
      'parked',
    ]);
    expect(view.counts).toEqual({
      live: 1,
      gated: 1,
      parked: 1,
      down: 1,
      unchecked: 0,
    });
  });

  test('only categories with working hosts get a filter', () => {
    expect(view.categories.map((entry) => entry.category)).toEqual([
      'game',
      'platform',
    ]);
  });

  test('without probes every host is unchecked, not offline', () => {
    const unchecked = buildServiceIndexView(
      snapshot,
      null,
      '2026-01-01T00:00:00.000Z'
    );
    expect(unchecked.checkedAt).toBeNull();
    expect(unchecked.closed).toEqual([]);
    expect(unchecked.counts.unchecked).toBe(4);
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
    expect(artSvg('a.dev', 'A', 'game')).toBe(artSvg('a.dev', 'A', 'game'));
    expect(artSvg('a.dev', 'A', 'game')).not.toBe(artSvg('b.dev', 'A', 'game'));
    expect(hash('a')).not.toBe(hash('b'));
  });

  test('escapes the title and draws a two-letter monogram', () => {
    expect(artSvg('a.dev', '<x>', 'ops')).not.toContain('<x>');
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
