import { useState } from 'react';
import { Button, Stack } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import type { Client, Session } from './model';
import { useResource } from './use-resource';
import { ErrorNotice, PageHeading } from './shared';
import {
  RegistrationDrawer,
  type EditorSelection,
} from './registration-drawer';
import { ClientStats } from './client-stats';
import { ApplicationDirectory } from './application-directory';

export function Applications({ session }: { session: Session }) {
  const resource = useResource<Client[]>('/api/clients', session);
  const [editor, setEditor] = useState<EditorSelection>();
  const create = () => setEditor({ key: crypto.randomUUID() });
  return (
    <Stack id="console" gap="lg">
      <PageHeading
        title="Applications"
        description="Connect your projects to a shared sign-in. Keep their sessions independent."
        action={
          <Button leftSection={<IconPlus size={17} />} onClick={create}>
            New application
          </Button>
        }
      />
      <ClientStats clients={resource.data ?? []} loading={!resource.data} />
      <ErrorNotice message={resource.error} retry={resource.reload} />
      <ApplicationDirectory
        resource={resource}
        onCreate={create}
        onEdit={(client) => setEditor({ client, key: crypto.randomUUID() })}
      />
      {editor && (
        <RegistrationDrawer
          key={editor.key}
          editor={editor}
          session={session}
          onSaved={resource.reload}
          onClose={() => setEditor(undefined)}
        />
      )}
    </Stack>
  );
}
