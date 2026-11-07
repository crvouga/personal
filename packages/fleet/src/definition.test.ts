import { expect, test } from 'bun:test';
import source from '../definition.json';
import { enrolledRoster, parseDefinition } from './definition';

test('canonical definition contains one existing Linux proxy owner and monitoring parent', () => {
  const definition = parseDefinition(source);
  expect(
    definition.nodes.find((node) => node.id === definition.proxy.owner)?.os
  ).toBe('linux');
  expect(definition.proxy.endpoint).toBe('https://cli-proxy.chrisvouga.dev');
});
test('missing, duplicate, non-Linux and arbitrary endpoint owner assignments fail closed', () => {
  for (const proxy of [
    { owner: 'missing', endpoint: source.proxy.endpoint },
    { owner: 'mac-studio', endpoint: source.proxy.endpoint },
    { ...source.proxy, endpoint: 'https://other.invalid' },
  ])
    expect(() => parseDefinition({ ...source, proxy })).toThrow();
  expect(() =>
    parseDefinition({ ...source, nodes: [...source.nodes, source.nodes[0]] })
  ).toThrow();
});
test('portable definitions do not authorize peers or invent controller paths', () => {
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
