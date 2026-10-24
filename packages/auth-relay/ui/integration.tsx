import {
  Accordion,
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { connectionSettings, type Session } from './model';
import { CopyValue, PageHeading } from './shared';

export function Integration({ session }: { session: Session }) {
  return (
    <Stack gap="lg">
      <PageHeading
        title="Integration guide"
        description="Standard OpenID Connect. One shared identity provider, your own application session."
      />
      <AgentIntegration />
      <Paper withBorder p="xl">
        <Stack gap="lg">
          <Title order={2} size="h4">
            Connect in three steps
          </Title>
          <GuideStep number="01" title="Register your application">
            Create an application with its exact callback URL. Use a separate
            instance for every concurrent local server and preview.
          </GuideStep>
          <GuideStep number="02" title="Configure your OIDC library">
            Copy the issuer, client ID, callback, and scopes from your
            application's connection settings. Use a maintained OIDC library for
            your framework.
          </GuideStep>
          <GuideStep number="03" title="Sign in and create a session">
            Use authorization code with S256 PKCE, random state, and nonce.
            Validate token signature, issuer, audience, nonce, and expiry before
            creating your application's session.
          </GuideStep>
          <CopyValue label="Issuer" value={session.issuer} />
          <CopyValue
            label="Discovery URL"
            value={`${session.issuer}/.well-known/openid-configuration`}
          />
        </Stack>
      </Paper>
      <Accordion variant="separated">
        <Accordion.Item value="profile">
          <Accordion.Control>Supported connection profile</Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              Public clients using authorization code + S256 PKCE, with scopes
              openid email profile and token_endpoint_auth_method=none. Refresh,
              password, and implicit grants are not supported. Each application
              owns its permissions and session.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="callbacks">
          <Accordion.Control>
            Callbacks and registration lifetime
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              Production callbacks require HTTPS. Nonproduction supports exact
              localhost ports. No wildcards, query strings, or fragments. Leases
              last at most 366 days in production and seven days in
              nonproduction. Renew explicitly before expiry.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Alert color="indigo" title="Independent by design">
        Identify users by issuer and subject, never email alone. Keep tokens out
        of URLs and persistent browser storage.
      </Alert>
    </Stack>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: string;
}) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="lg">
      <Text c="indigo" fw={700} size="sm" pt={2}>
        {number}
      </Text>
      <Stack gap={4}>
        <Text fw={650} size="sm">
          {title}
        </Text>
        <Text size="sm" c="dimmed">
          {children}
        </Text>
      </Stack>
    </Group>
  );
}

export function ConnectionSettings({
  issuer,
  id,
  callbacks,
}: {
  issuer: string;
  id: string;
  callbacks: string[];
}) {
  callbacks = [...new Set(callbacks)];
  const [selected, setSelected] = useState<string | null>(null);
  const callback =
    selected && callbacks.includes(selected) ? selected : (callbacks[0] ?? '');
  const settings = connectionSettings(issuer, id, callback);
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={650} size="sm">
          Connection settings
        </Text>
        <CopyButton value={settings}>
          {({ copy, copied }) => (
            <Button variant="light" size="xs" onClick={copy}>
              {copied ? 'Copied' : 'Copy .env'}
            </Button>
          )}
        </CopyButton>
      </Group>
      {callbacks.length > 1 && (
        <Select
          label="Callback URL"
          data={callbacks}
          value={callback}
          onChange={setSelected}
          allowDeselect={false}
        />
      )}
      <Code id="settings" block>
        {settings}
      </Code>
      <Text size="xs" c="dimmed">
        Use authorization code + S256 PKCE, state, and nonce.{' '}
        <Text component="a" href="#integration" inherit c="indigo">
          Read the integration guide
        </Text>
      </Text>
    </Stack>
  );
}

function AgentIntegration() {
  return (
    <Alert title="Integrating from another repository?" color="indigo">
      <Text component="a" href="https://www.chrisvouga.dev/llms.txt" inherit>
        Open the shared hosting, PostgreSQL, object storage and authentication
        guide.
      </Text>{' '}
      Agents can register, renew, change exact ports and revoke their
      applications using a Vault credential approved in{' '}
      <Text component="a" href="#agents" inherit>
        Agent access
      </Text>
      . No Google or relay administration secrets belong in your project.
    </Alert>
  );
}
