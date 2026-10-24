import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconCheck, IconUserPlus } from '@tabler/icons-react';
import { request } from './api';
import { errorMessage, type Session } from './model';
import { CopyValue, ErrorNotice, PageHeading } from './shared';
import { useResource } from './use-resource';

export function Operators({ session }: { session: Session }) {
  const resource = useResource<{ subject: string }[]>(
    '/api/operators',
    session
  );
  return (
    <Stack gap="lg">
      <PageHeading
        title="Operators"
        description="Manage the trusted people who administer this relay environment."
      />
      <Alert color="indigo" title="Environment-wide access">
        Operators can register callbacks for every project in this environment.
        Only grant access to trusted infrastructure administrators.
      </Alert>
      <Paper withBorder p="lg">
        <Stack>
          <Group justify="space-between">
            <Title order={2} size="h4">
              Authorized operators
            </Title>
            <Badge variant="light">{resource.data?.length ?? '…'}</Badge>
          </Group>
          <ErrorNotice message={resource.error} retry={resource.reload} />
          {resource.loading && !resource.data && <Skeleton height={70} />}
          {resource.data?.map(({ subject }) => (
            <CopyValue
              key={subject}
              label={
                subject === session.subject
                  ? 'Relay subject · you'
                  : 'Relay subject'
              }
              value={subject}
            />
          ))}
        </Stack>
      </Paper>
      <AddOperator session={session} onAdded={resource.reload} />
    </Stack>
  );
}

function AddOperator({
  session,
  onAdded,
}: {
  session: Session;
  onAdded: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      await request('/api/operators', session, {
        method: 'POST',
        body: { subject: subject.trim() },
      });
      setSubject('');
      setSuccess(true);
      onAdded();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper withBorder p="lg">
      <Stack>
        <AddOperatorHeading />
        <form id="operator-form" onSubmit={submit}>
          <Stack>
            <TextInput
              id="operator-subject"
              label="Exact relay subject"
              placeholder="Paste their relay subject"
              required
              maxLength={255}
              value={subject}
              onChange={(event) => {
                setSubject(event.currentTarget.value);
                setSuccess(false);
              }}
            />
            <ErrorNotice message={error} />
            {success && (
              <Alert color="teal" icon={<IconCheck size={18} />} role="status">
                Operator added.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                type="submit"
                leftSection={<IconUserPlus size={17} />}
                loading={busy}
              >
                Add operator
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}

function AddOperatorHeading() {
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        Add an operator
      </Title>
      <Text size="sm" c="dimmed">
        Ask the person to sign in and share the relay subject shown on their
        access screen.
      </Text>
    </Stack>
  );
}
