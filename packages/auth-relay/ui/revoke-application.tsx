import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { request } from './api';
import { errorMessage, type Client, type Session } from './model';
import { ErrorNotice } from './shared';

export function RevokeApplication({
  client,
  session,
  onRevoked,
  disabled,
}: {
  client: Client;
  session: Session;
  onRevoked: () => void;
  disabled: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [revoked, setRevoked] = useState(client.revoked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await request(`/api/clients/${client.id}`, session, { method: 'DELETE' });
      setRevoked(true);
      setOpened(false);
      onRevoked();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack gap="xs">
      <Text fw={650} size="sm">
        Revoke access
      </Text>
      <Text size="xs" c="dimmed">
        Stops new sign-ins and token exchanges. Existing application sessions
        follow their own policy.
      </Text>
      <Group>
        <Button
          color="red"
          variant="light"
          disabled={disabled || revoked}
          onClick={() => setOpened(true)}
        >
          {revoked ? 'Registration revoked' : 'Revoke registration'}
        </Button>
      </Group>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title="Revoke this application?"
        closeButtonProps={{ 'aria-label': 'Cancel revocation' }}
        centered
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
      >
        <RevokeConfirmation
          client={client}
          error={error}
          busy={busy}
          cancel={() => setOpened(false)}
          revoke={revoke}
        />
      </Modal>
    </Stack>
  );
}

function RevokeConfirmation({
  client,
  error,
  busy,
  cancel,
  revoke,
}: {
  client: Client;
  error: string;
  busy: boolean;
  cancel: () => void;
  revoke: () => Promise<void>;
}) {
  return (
    <Stack>
      <Text size="sm">
        New sign-ins for{' '}
        <Text span fw={600}>
          {(client.config ?? client.desired).name}
        </Text>{' '}
        will stop immediately. You can reactivate it by saving its registration
        again.
      </Text>
      <ErrorNotice message={error} />
      <Group justify="flex-end">
        <Button variant="default" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
        <Button color="red" loading={busy} onClick={revoke}>
          Revoke registration
        </Button>
      </Group>
    </Stack>
  );
}
