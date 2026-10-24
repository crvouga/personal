import { useState, type ReactNode } from 'react';
import { Badge, Box, Button, Divider, Stack, Text } from '@mantine/core';
import {
  IconApps,
  IconBook2,
  IconLogout,
  IconUsers,
  IconRobot,
} from '@tabler/icons-react';
import { AdminShell } from '@pkgs/admin-ui/shell';
import { request } from './api';
import { errorMessage, type Session } from './model';
import { ErrorNotice, localIdentity } from './shared';
import { usePage } from './navigation';

const navigation = [
  { id: 'applications', label: 'Applications', icon: IconApps },
  { id: 'agents', label: 'Agent access', icon: IconRobot },
  { id: 'operators', label: 'Operators', icon: IconUsers },
  { id: 'integration', label: 'Integration guide', icon: IconBook2 },
];
export function ConsoleShell({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const page = usePage();
  const items = session.operator
    ? navigation.map(({ id, label, icon: Icon }) => ({
        href: `#${id}`,
        label,
        icon: <Icon size={19} />,
        active: page === id,
      }))
    : [];
  return (
    <AdminShell
      name="Relay"
      subtitle="Identity console"
      navigation={items}
      account={<ShellAccount session={session} />}
      header={
        <>
          <Badge
            variant="dot"
            color={session.environment === 'production' ? 'teal' : 'indigo'}
          >
            {localIdentity ? 'Local test' : session.environment}
          </Badge>
          {localIdentity && (
            <Badge color="yellow" variant="light" visibleFrom="md">
              LOCAL DEVELOPMENT
            </Badge>
          )}
        </>
      }
    >
      {children}
    </AdminShell>
  );
}

function ShellAccount({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setBusy(true);
    try {
      await request('/api/logout', session, { method: 'POST' });
      window.location.assign('/');
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <Box>
      <Stack gap="md">
        <Box px="sm">
          <Text size="xs" fw={600}>
            Operator console
          </Text>
          <Text size="xs" c="dimmed">
            Exact connections. Explicit access.
          </Text>
        </Box>
        <Divider />
        <Box px="sm">
          <Text size="xs" c="dimmed" mb={4}>
            Signed in as
          </Text>
          <Text size="xs" ff="monospace" className="break-word">
            {session.subject}
          </Text>
        </Box>
        <ErrorNotice message={error} />
        <Button
          id="logout"
          variant="subtle"
          color="gray"
          leftSection={<IconLogout size={17} />}
          onClick={logout}
          loading={busy}
          justify="start"
        >
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}
