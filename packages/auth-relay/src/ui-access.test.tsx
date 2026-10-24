import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { AccessRequired, SignedOut, Unavailable } from '../ui/access';
import { initialValues } from '../ui/use-registration';
import {
  clientStatus,
  localDateTime,
  type Client,
  type Session,
} from '../ui/model';

const session: Session = {
  csrf: 'test-csrf',
  operator: false,
  setup: false,
  issuer: 'https://auth.example/realms/projects',
  environment: 'nonproduction',
  subject: '<relay-subject>',
};
const config = {
  name: 'Test app',
  project: 'test',
  instance: 'primary',
  environment: 'localhost',
  callbacks: ['http://localhost:5173/callback'],
  expiresAt: '2026-11-01T15:30:00.000Z',
};
const client: Client = {
  id: 'app-test',
  revision: 3,
  config,
  desired: config,
  revoked: false,
  expires_at: config.expiresAt,
};
function render(children: ReactNode) {
  return renderToStaticMarkup(
    <MantineProvider env="test">{children}</MantineProvider>
  );
}

test('nonoperators get an escaped subject and no setup or registration form', () => {
  const html = render(<AccessRequired session={session} reload={() => {}} />);
  expect(html).toContain('Not authorized');
  expect(html).toContain('&lt;relay-subject&gt;');
  expect(html).not.toContain('id="setup-form"');
  expect(html).not.toContain('id="registration"');
});
test('only bootstrap-eligible accounts see the one-time setup form', () => {
  const html = render(
    <AccessRequired session={{ ...session, setup: true }} reload={() => {}} />
  );
  expect(html).toContain('Authorize the first operator');
  expect(html).toContain('id="setup-token"');
  expect(html).not.toContain('id="registration"');
});
test('signed-out and unavailable screens offer distinct recovery actions', () => {
  expect(render(<SignedOut />)).toContain('Continue with Google');
  const html = render(<Unavailable retry={() => {}} />);
  expect(html).toContain('Authentication relay unavailable');
  expect(html).toContain('Try again');
  expect(html).not.toContain('Not authorized');
});
test('editing preserves the saved expiry as local time and requires fresh ownership confirmation', () => {
  const values = initialValues(session, client);
  expect(new Date(values.expiresAt).toISOString()).toBe(config.expiresAt);
  expect(values.ownership).toBe(false);
  expect(values.project).toBe(config.project);
  expect(values.callbacks).toBe(config.callbacks.join('\n'));
});
test('new and pending registrations have usable defaults and keep their identity', () => {
  expect(initialValues(session).environment).toBe('localhost');
  expect(
    initialValues({ ...session, environment: 'production' }).environment
  ).toBe('production');
  expect(initialValues(session, { ...client, config: null }).project).toBe(
    'test'
  );
  expect(localDateTime(new Date('2026-10-24T15:30:00Z'))).toMatch(
    /2026-10-24T\d{2}:30/
  );
});
test('revoked and pending records never appear active; expired leases need attention', () => {
  expect(clientStatus({ ...client, config: null })).toBe('Pending');
  expect(clientStatus({ ...client, config: null, revoked: true })).toBe(
    'Revoked'
  );
  expect(clientStatus({ ...client, expires_at: '2000-01-01' })).toBe('Expired');
  expect(
    clientStatus({
      ...client,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
  ).toBe('Active');
});
