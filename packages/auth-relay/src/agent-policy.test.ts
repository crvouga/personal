import { expect, test } from 'bun:test';
import { agentGrant, authorizeRegistration } from './agent-policy';
import { registration } from './policy';

const grant = () => ({
  tokenHash: 'a'.repeat(64),
  project: 'my-app',
  environments: ['localhost', 'preview'],
  origins: ['https://my-app.example'],
  allowLoopback: true,
  expiresAt: new Date(Date.now() + 7200000).toISOString(),
});
const input = () => ({
  name: 'App',
  project: 'my-app',
  environment: 'localhost',
  instance: 'one',
  callbacks: ['http://localhost:5173/callback'],
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});

test('grant scopes permit changing exact loopback ports and unrelated owned HTTPS domains', () => {
  const scope = agentGrant(grant(), false);
  for (const callback of [
    'http://localhost:3000/callback',
    'http://127.0.0.1:43123/callback',
    'https://my-app.example/auth/callback',
  ])
    expect(() =>
      authorizeRegistration(
        scope,
        registration({ ...input(), callbacks: [callback] }, false)
      )
    ).not.toThrow();
});
test('agents cannot exceed project, environment, origin or expiry delegation', () => {
  const scope = agentGrant(grant(), false);
  for (const changes of [
    { project: 'other' },
    { environment: 'ci' },
    { callbacks: ['https://my-app.example.attacker.com/callback'] },
    { expiresAt: new Date(Date.now() + 10800000).toISOString() },
  ])
    expect(() =>
      authorizeRegistration(
        scope,
        registration({ ...input(), ...changes }, false)
      )
    ).toThrow();
  expect(() =>
    authorizeRegistration(
      { ...scope, allowLoopback: false },
      registration(input(), false)
    )
  ).toThrow();
});
test('grant validation rejects raw credentials, wildcards, URL parts and wrong environments', () => {
  for (const changes of [
    { tokenHash: 'raw-token'.repeat(6) },
    { environments: [] },
    { environments: ['production'] },
    { allowLoopback: 'true' },
    { origins: ['https://*.example.com'] },
    { origins: ['https://my-app.example/'] },
    { origins: ['https://user:pass@my-app.example'] },
    { origins: ['http://localhost:3000'] },
    { origins: [], allowLoopback: false },
  ])
    expect(() => agentGrant({ ...grant(), ...changes }, false)).toThrow();
});
test('production grants require HTTPS origins, production environment and a bounded lease', () => {
  const scope = {
    ...grant(),
    environments: ['production'],
    allowLoopback: false,
  };
  expect(agentGrant(scope, true)).toEqual(scope);
  expect(() => agentGrant({ ...scope, allowLoopback: true }, true)).toThrow();
  expect(() =>
    agentGrant(
      {
        ...scope,
        expiresAt: new Date(Date.now() + 367 * 86400000).toISOString(),
      },
      true
    )
  ).toThrow();
  expect(() =>
    agentGrant({ ...grant(), expiresAt: 'invalid' }, false)
  ).toThrow();
});
