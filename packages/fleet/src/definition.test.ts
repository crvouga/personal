import { expect, test } from 'bun:test';
import source from '../definition.json';
import { enrolledRoster, parseDefinition } from './definition';
import { hostId, hubUrl, roleOf } from './topology';

test('canonical topology is one macOS manager and Linux workers', () => {
  const definition = parseDefinition(source);
  expect(definition.manager.id).toBe('chriss-macbook-air');
  expect(definition.manager.os).toBe('macOS');
  expect(definition.manager.neverSleepOnPower).toBe(true);
  expect(definition.workers.length).toBeGreaterThan(0);
  expect(definition.workers.every((worker) => worker.os === 'linux')).toBe(
    true
  );
  expect(definition.services.proxy.endpoint).toBe(
    'https://cli-proxy.chrisvouga.dev'
  );
  expect(roleOf(definition, 'chriss-macbook-air')).toBe('manager');
  expect(roleOf(definition, 'chris-vouga-ms-a2')).toBe('worker');
  expect(roleOf(definition, 'unknown')).toBeNull();
  expect(hubUrl(definition)).toBe(
    'https://chriss-macbook-air-1.tail4829dc.ts.net:8443'
  );
});
test('singletons never name a host and the topology fails closed', () => {
  const worker = source.workers[0]!;
  for (const invalid of [
    // A singleton service cannot be pinned to a host.
    {
      ...source,
      services: {
        ...source.services,
        proxy: { ...source.services.proxy, owner: worker.id },
      },
    },
    {
      ...source,
      services: {
        ...source.services,
        proxy: { endpoint: 'http://not-https.invalid/path' },
      },
    },
    // Endpoints, accounts and the source repository are this fleet's own
    // configuration: any well-formed value is accepted, a missing one is not.
    { ...source, source: undefined },
    { ...source, source: { repository: 'git@github.com:owner/repo' } },
    {
      ...source,
      services: {
        ...source.services,
        monitoring: { hubPort: 8443 },
      },
    },
    // Exactly one manager, on macOS, kept awake.
    { ...source, manager: undefined },
    { ...source, manager: { ...source.manager, os: 'linux' } },
    { ...source, manager: { ...source.manager, neverSleepOnPower: false } },
    // Workers are Linux, unique, and never the manager.
    { ...source, workers: [{ ...worker, os: 'macOS' }] },
    { ...source, workers: [...source.workers, worker] },
    { ...source, workers: [{ ...worker, id: source.manager.id }] },
    // The previous owner/parent shape is rejected.
    { ...source, version: 2 },
  ])
    expect(() => parseDefinition(invalid)).toThrow();
});
test('manager host names normalize to the fleet id', () => {
  expect(hostId('Chriss-MacBook-Air')).toBe('chriss-macbook-air');
  expect(hostId('Chriss-MacBook-Air.local')).toBe('chriss-macbook-air');
});
test('portable definitions do not authorize peers or invent manager paths', () => {
  const definition = parseDefinition(source);
  const node = {
    id: 'chris-vouga-mac-studio',
    ssh: 'chris-vouga-mac-studio',
    workspace: '/a real/path',
    required: [],
  };
  expect(
    enrolledRoster(definition, { version: 1, nodes: [node] }).nodes
  ).toEqual([{ ...node, required: definition.worker!.requiredCapabilities }]);
  expect(() =>
    enrolledRoster(definition, {
      version: 1,
      nodes: [{ ...node, id: 'discovered' }],
    })
  ).toThrow();
  expect(() =>
    enrolledRoster(definition, {
      version: 1,
      nodes: [{ ...node, ssh: 'other' }],
    })
  ).toThrow('conflicts');
});

test('another fleet declares its own endpoints, accounts and repository', () => {
  const other = parseDefinition({
    ...source,
    source: { repository: 'https://git.example.org/team/machines.git' },
    services: {
      proxy: { endpoint: 'https://proxy.example.org' },
      monitoring: {
        hubPort: 8443,
        publicUrl: 'https://status.example.org',
        managerAccount: 'fleet@example.org',
        viewerAccount: 'viewer@example.org',
      },
    },
  });
  expect(other.services.proxy.endpoint).toBe('https://proxy.example.org');
  expect(other.source.repository).toBe(
    'https://git.example.org/team/machines.git'
  );
});
