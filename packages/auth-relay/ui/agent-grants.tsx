import { useState } from 'react';
import { Alert, Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { request } from './api';
import { useResource } from './use-resource';
import { errorMessage, type Session } from './model';
import { ErrorNotice, PageHeading } from './shared';
import { AgentGrantEditor } from './agent-grant-editor';
import type { AgentGrant } from '../src/agent-policy';

export interface GrantRecord {
  id: string;
  config: AgentGrant;
  revision: number;
  revoked: boolean;
}

export function AgentGrants({ session }: { session: Session }) {
  const resource = useResource<GrantRecord[]>('/api/agent-grants', session);
  const [selected, setSelected] = useState<GrantRecord | null>();
  const [error, setError] = useState('');
  async function revoke(record: GrantRecord) {
    if (
      !window.confirm(
        `Revoke agent access for ${record.config.project}? Existing application sign-ins remain registered; revoke applications separately if needed.`
      )
    )
      return;
    try {
      await request(`/api/agent-grants/${record.id}`, session, {
        method: 'DELETE',
      });
      setError('');
      resource.reload();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <Stack gap="lg">
      <PageHeading
        title="Agent access"
        description="Delegate registration without sharing an operator session or control-plane credentials."
      />
      <Alert title="Vault holds the credential" color="indigo">
        Provision an isolated credential through OpenTofu, then paste only its
        SHA-256 fingerprint here. Verify project and domain ownership before
        approving exact origins. Anyone who can read that credential can
        exercise this grant.
        <Text component="a" href="https://www.chrisvouga.dev/llms.txt" inherit>
          {' '}
          Read the agent onboarding guide.
        </Text>
      </Alert>
      <Group>
        <Button onClick={() => setSelected(null)}>Authorize an agent</Button>
        <Button variant="subtle" onClick={resource.reload}>
          Refresh
        </Button>
      </Group>
      <ErrorNotice message={resource.error || error} retry={resource.reload} />
      {resource.data?.length === 0 && (
        <Text c="dimmed">No agent credentials authorized.</Text>
      )}
      {resource.data?.map((record) => (
        <GrantCard
          key={record.id}
          record={record}
          edit={() => setSelected(record)}
          revoke={() => void revoke(record)}
        />
      ))}
      {selected !== undefined && (
        <AgentGrantEditor
          key={selected?.id ?? 'new'}
          session={session}
          record={selected}
          close={() => setSelected(undefined)}
          saved={resource.reload}
        />
      )}
    </Stack>
  );
}

function GrantCard({
  record,
  edit,
  revoke,
}: {
  record: GrantRecord;
  edit: () => void;
  revoke: () => void;
}) {
  return (
    <Paper withBorder p="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={650}>{record.config.project}</Text>
          <Badge color={record.revoked ? 'red' : 'indigo'}>
            {record.revoked
              ? 'Revoked'
              : new Date(record.config.expiresAt) <= new Date()
                ? 'Expired'
                : 'Authorized'}
          </Badge>
        </Group>
        <Text size="sm">
          {record.config.environments.join(', ')} · Expires{' '}
          {record.config.expiresAt}
        </Text>
        <Text size="sm">
          {[
            ...record.config.origins,
            ...(record.config.allowLoopback
              ? ['HTTP localhost / 127.0.0.1, any explicit port']
              : []),
          ].join(', ')}
        </Text>
        <Text size="xs" ff="monospace" className="break-word">
          SHA-256: {record.config.tokenHash}
        </Text>
        <Group>
          <Button variant="light" onClick={edit}>
            Edit / rotate / renew
          </Button>
          <Button
            color="red"
            variant="subtle"
            disabled={record.revoked}
            onClick={revoke}
          >
            Revoke access
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
