import { useState } from 'react';
import { useDocumentTitle } from '@mantine/hooks';
import {
  Alert,
  Button,
  Center,
  Container,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconArrowRight, IconLock, IconShieldCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { request } from './api';
import { errorMessage, type Session } from './model';
import { Brand, CopyValue, ErrorNotice, localIdentity } from './shared';
import { ThemePicker } from './theme-picker';

export function AccessFrame({ children }: { children: ReactNode }) {
  return (
    <Center mih="100dvh" p="md">
      <Container size={460} w="100%">
        <Stack gap="xl">
          <Stack component="header" gap="lg">
            <Group justify="space-between" wrap="nowrap">
              <Brand />
              <ThemePicker />
            </Group>
            {localIdentity && (
              <Alert color="yellow" title="LOCAL DEVELOPMENT">
                Mock identity provider. This is not Google sign-in.
              </Alert>
            )}
          </Stack>
          <Paper withBorder p="xl" radius="lg" shadow="xs">
            <Stack gap="lg">{children}</Stack>
          </Paper>
          <Text size="xs" c="dimmed" ta="center">
            One identity provider. Independent application sessions.
          </Text>
        </Stack>
      </Container>
    </Center>
  );
}

export function SignedOut() {
  useDocumentTitle('Sign in · Relay');
  return (
    <AccessFrame>
      <ThemeIcon size={48} variant="light" radius="lg">
        <IconLock size={26} />
      </ThemeIcon>
      <Stack gap="xs">
        <Title order={1} size="h2">
          Your projects. One sign-in.
        </Title>
        <Text c="dimmed" size="sm">
          Manage application connections and trusted access from one place.
        </Text>
      </Stack>
      <Button
        component="a"
        href="/auth/login"
        size="md"
        rightSection={<IconArrowRight size={18} />}
      >
        {localIdentity
          ? 'Continue with local test identity'
          : 'Continue with Google'}
      </Button>
      <Divider />
      <Text size="xs" c="dimmed">
        This console is for authorized operators. Signing in does not
        automatically grant access.
      </Text>
    </AccessFrame>
  );
}

export function Unavailable({ retry }: { retry: () => void }) {
  useDocumentTitle('Unavailable · Relay');
  return (
    <AccessFrame>
      <Title order={1} size="h2">
        Authentication relay unavailable
      </Title>
      <Text c="dimmed">
        We could not check your access. Please try again shortly.
      </Text>
      <Button onClick={retry}>Try again</Button>
    </AccessFrame>
  );
}

export function AccessRequired({
  session,
  reload,
}: {
  session: Session;
  reload: () => void;
}) {
  useDocumentTitle(`${session.setup ? 'Setup' : 'Access required'} · Relay`);
  return (
    <Stack maw={560} mx="auto" py="xl" gap="lg">
      <ThemeIcon size={48} variant="light" radius="lg">
        <IconShieldCheck size={26} />
      </ThemeIcon>
      <Title order={1} size="h2">
        {session.setup ? 'Authorize the first operator' : 'Not authorized'}
      </Title>
      <Text c="dimmed">
        {session.setup
          ? 'Complete the one-time setup to manage this relay.'
          : 'You signed in successfully. Ask an existing operator to grant access using your exact relay subject.'}
      </Text>
      <CopyValue label="Your relay subject" value={session.subject} />
      {session.setup && <SetupForm session={session} reload={reload} />}
    </Stack>
  );
}

function SetupForm({
  session,
  reload,
}: {
  session: Session;
  reload: () => void;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/api/setup', session, { method: 'POST', body: { token } });
      setToken('');
      reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper withBorder p="lg" radius="md">
      <form id="setup-form" onSubmit={submit}>
        <Stack>
          <Text size="sm" c="dimmed">
            {localIdentity
              ? 'Local setup credential: local-development-only.'
              : 'Use the one-time setup credential from Vault.'}{' '}
            A Google account alone does not grant access.
          </Text>
          <PasswordInput
            id="setup-token"
            label="Setup credential"
            required
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          <ErrorNotice message={error} />
          <Button type="submit" loading={busy}>
            Authorize
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
