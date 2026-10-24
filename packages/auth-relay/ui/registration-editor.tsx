import {
  Alert,
  Button,
  Divider,
  Fieldset,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { Client, Session } from './model';
import { ErrorNotice } from './shared';
import { RegistrationFields } from './registration-form';
import { ConnectionSettings } from './integration';
import { RevokeApplication } from './revoke-application';
import { useRegistration } from './use-registration';
import { useDraftStatus, type DraftStatus } from './use-draft-status';

type EditorProps = {
  client: Client | undefined;
  session: Session;
  onSaved: () => void;
  onRevoked: () => void;
  onStatusChange: (status: DraftStatus) => void;
};

export function RegistrationEditor(props: EditorProps) {
  const { session } = props;
  const editor = useRegistration(props);
  const client = editor.client;
  useDraftStatus(
    { dirty: editor.form.isDirty(), busy: editor.busy },
    props.onStatusChange
  );
  return (
    <Stack gap="lg" pb="lg">
      <EditorHeading client={client} />
      <form id="registration" onSubmit={editor.form.onSubmit(editor.save)}>
        <Stack gap="lg">
          <Fieldset disabled={editor.busy} variant="unstyled">
            <RegistrationFields
              form={editor.form}
              immutable={!!client || editor.revision > 0}
              production={session.environment === 'production'}
            />
          </Fieldset>
          <ErrorNotice message={editor.error} />
          <Group justify="flex-end">
            <Button type="submit" loading={editor.busy}>
              Save registration
            </Button>
          </Group>
        </Stack>
      </form>
      {editor.saved && (
        <Alert
          color="teal"
          icon={<IconCheck size={18} />}
          title="Registration saved"
          role="status"
        >
          Your connection settings are ready. Copy them into your application.
        </Alert>
      )}
      {client?.config?.callbacks && (
        <>
          <Divider />
          <ConnectionSettings
            issuer={session.issuer}
            id={editor.id}
            callbacks={client.config.callbacks}
          />
        </>
      )}
      {client && (
        <>
          <Divider />
          <RevokeApplication
            key={client.revision}
            client={client}
            session={session}
            onRevoked={props.onRevoked}
            disabled={editor.busy}
          />
        </>
      )}
    </Stack>
  );
}

function EditorHeading({ client }: { client: Client | undefined }) {
  return (
    <Stack gap={5}>
      <Title order={2} size="h3">
        {client
          ? (client.config ?? client.desired).name
          : 'Register an application'}
      </Title>
      <Text size="sm" c="dimmed">
        {client
          ? 'Manage callbacks, renew access, and copy connection settings.'
          : 'A new connection starts with an exact callback URL.'}
      </Text>
      {client?.revoked && (
        <Alert color="orange" title="Registration revoked">
          Saving this registration reactivates new sign-ins.
        </Alert>
      )}
    </Stack>
  );
}
