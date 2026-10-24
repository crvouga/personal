import { useState } from 'react';
import { useForm } from '@mantine/form';
import { request } from './api';
import {
  errorMessage,
  localDateTime,
  type Registration,
  type Client,
  type Session,
} from './model';
import type { EditorValues } from './registration-form';
import { callbackLines, registrationValidation } from './editor-validation';

export function initialValues(session: Session, client?: Client): EditorValues {
  if (client) {
    const config = client.config ?? client.desired;
    return {
      ...config,
      callbacks: config.callbacks.join('\n'),
      expiresAt: localDateTime(new Date(client.expires_at)),
      ownership: false,
    };
  }
  return {
    name: '',
    project: '',
    instance: 'primary',
    environment:
      session.environment === 'production' ? 'production' : 'localhost',
    callbacks: '',
    expiresAt: localDateTime(new Date(Date.now() + 86400_000)),
    ownership: false,
  };
}

export function useRegistration({
  client,
  session,
  onSaved,
}: {
  client: Client | undefined;
  session: Session;
  onSaved: () => void;
}) {
  const [id] = useState(() => client?.id ?? `app-${crypto.randomUUID()}`);
  const [revision, setRevision] = useState(client?.revision ?? 0);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [currentClient, setCurrentClient] = useState(client);
  const form = useForm<EditorValues>({
    initialValues: initialValues(session, client),
    validate: registrationValidation(session.environment === 'production'),
    onValuesChange: () => setSaved(false),
  });
  async function save(values: EditorValues) {
    setBusy(true);
    setError('');
    setSaved(false);

    try {
      const config: Registration = {
        name: values.name,
        project: values.project,
        environment: values.environment,
        instance: values.instance,
        callbacks: callbackLines(values.callbacks),
        expiresAt: new Date(values.expiresAt).toISOString(),
      };
      const result = await request<{ revision: number }>(
        `/api/clients/${id}`,
        session,
        {
          method: 'PUT',
          body: { ...config, revision },
        }
      );
      setRevision(result.revision);
      setCurrentClient({
        id,
        revision: result.revision,
        config,
        desired: config,
        revoked: false,
        expires_at: config.expiresAt,
      });
      setSaved(true);
      form.resetDirty(values);
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return {
    id,
    revision,
    saved,
    busy,
    error,
    client: currentClient,
    form,
    save,
  };
}
