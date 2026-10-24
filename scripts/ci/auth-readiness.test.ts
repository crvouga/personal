import { expect, test } from 'bun:test';
import {
  stableWindow,
  waitForEndpoint,
  waitForInstances,
} from './auth-readiness';

const entry = {
  url: 'https://admin.example',
  access_client_id: 'private-id',
  access_client_secret: 'private-secret',
};

test('only proven no-op/gateway-only plans avoid identity rollout stability waiting', () => {
  for (const changes of [
    '[]',
    '["module.broker[\\"production\\"].railway_service.this"]',
  ]) {
    expect(stableWindow(changes, false, '[]')).toBe(0);
    expect(stableWindow(changes, true, '[]')).toBe(240_000);
  }
  for (const changes of [
    undefined,
    '',
    'invalid',
    '{}',
    '[null]',
    '["module.identity[\\"production\\"].railway_service.this"]',
    '["module.admin_connector[\\"production\\"].railway_service.this"]',
    '["unknown_resource.this"]',
  ])
    expect(stableWindow(changes, false, '[]')).toBe(240_000);
});

test('each identity keeps its full unbroken 240-second window and resets on an outage', async () => {
  let time = 0;
  let requests = 0;
  const messages: string[] = [];
  await waitForEndpoint('production', entry, 240_000, {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetch: async () => {
      requests++;
      return new Response(null, { status: requests === 10 ? 503 : 200 });
    },
    report: (message) => messages.push(message),
  });
  expect(time).toBe(340_000);
  expect(requests).toBe(35);
  expect(messages.join(' ')).not.toContain('private-');
});

test('unchanged hosting still requires a live successful discovery response', async () => {
  let time = 0;
  let calls = 0;
  await waitForEndpoint('production', entry, 0, {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetch: async () => new Response(null, { status: ++calls < 3 ? 503 : 200 }),
    report: () => {},
  });
  expect(calls).toBe(3);
  expect(time).toBe(20_000);
});

test('permanent readiness failures propagate without printing credentials or response bodies', async () => {
  let time = 0;
  const messages: string[] = [];
  await expect(
    waitForEndpoint('production', entry, 0, {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      fetch: async () => {
        throw new Error('private-secret response');
      },
      report: (message) => messages.push(message),
    })
  ).rejects.toThrow('did not satisfy');
  expect(time).toBe(1_200_000);
  expect(messages.join(' ')).not.toContain('private-secret');
});

test('independent instances overlap, and an instance failure prevents deployment continuation', async () => {
  const started: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await expect(
    waitForInstances(
      { production: entry, nonproduction: entry },
      240_000,
      async (name, _entry, duration) => {
        expect(duration).toBe(240_000);
        started.push(name);
        if (started.length === 2) release();
        await ready;
        if (name === 'production') throw new Error('not ready');
      }
    )
  ).rejects.toThrow('Auth admin readiness failed');
  expect(started).toEqual(['production', 'nonproduction']);
});

test('missing or changed foundation plans retain full stability for upstream networking and identities', () => {
  for (const upstream of [
    undefined,
    '',
    'invalid',
    '{}',
    '["cloudflare_zero_trust_tunnel_cloudflared.admin"]',
  ])
    expect(stableWindow('[]', false, upstream)).toBe(240_000);
});
