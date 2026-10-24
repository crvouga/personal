import { useState } from 'react';
import { useForm } from '@mantine/form';
import { Button, Modal, Stack } from '@mantine/core';
import { agentGrant } from '../src/agent-policy';
import { AgentGrantFields } from './agent-grant-fields';
import { request } from './api';
import { errorMessage, localDateTime, type Session } from './model';
import { ErrorNotice } from './shared';
import type { GrantRecord } from './agent-grants';

interface Props {
  session: Session;
  record: GrantRecord | null;
  close: () => void;
  saved: () => void;
}

export function AgentGrantEditor({ session, record, close, saved }: Props) {
  const { form, error, busy, save } = useAgentGrantEditor({
    session,
    record,
    close,
    saved,
  });
  return (
    <Modal
      opened
      onClose={() => {
        if (
          !form.isDirty() ||
          window.confirm('Discard unsaved agent access changes?')
        )
          close();
      }}
      title={record ? 'Edit agent access' : 'Authorize an agent'}
      size="lg"
    >
      <form onSubmit={form.onSubmit(save)}>
        <Stack>
          <AgentGrantFields
            form={form}
            production={session.environment === 'production'}
            editing={!!record}
          />
          <ErrorNotice message={error} />
          <Button type="submit" loading={busy}>
            Save agent access
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function useAgentGrantEditor({ session, record, close, saved }: Props) {
  const production = session.environment === 'production';
  const [initial] = useState(() => grantInitialValues(record, production));
  const [id] = useState(() => record?.id ?? `grant-${crypto.randomUUID()}`);
  const form = useForm({ initialValues: initial });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setError('');
    setBusy(true);
    try {
      if (!form.values.ownership)
        throw new Error(
          'Verify project, credential custody and domain ownership before approving.'
        );
      const input = agentGrant(
        {
          ...form.values,
          origins: form.values.origins
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
          expiresAt: new Date(form.values.expiresAt).toISOString(),
        },
        production
      );
      await request(`/api/agent-grants/${id}`, session, {
        method: 'PUT',
        body: { ...input, revision: record?.revision ?? 0 },
      });
      saved();
      close();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return { form, error, busy, save };
}

function grantInitialValues(record: GrantRecord | null, production: boolean) {
  if (record)
    return {
      ...record.config,
      origins: record.config.origins.join('\n'),
      expiresAt: localDateTime(new Date(record.config.expiresAt)),
      ownership: false,
    };
  return {
    project: '',
    tokenHash: '',
    environments: [production ? 'production' : 'localhost'],
    origins: '',
    allowLoopback: !production,
    expiresAt: localDateTime(new Date(Date.now() + 86400_000)),
    ownership: false,
  };
}
