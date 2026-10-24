import { useState } from 'react';
import { Button, Drawer, Group, Modal, Stack, Text } from '@mantine/core';
import type { Client, Session } from './model';
import { RegistrationEditor } from './registration-editor';
import type { DraftStatus } from './use-draft-status';

export interface EditorSelection {
  client?: Client;
  key: string;
}

export function RegistrationDrawer({
  editor,
  session,
  onClose,
  onSaved,
}: {
  editor: EditorSelection;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<DraftStatus>({
    dirty: false,
    busy: false,
  });
  const [confirming, setConfirming] = useState(false);
  function close() {
    if (status.busy) return;
    if (status.dirty) setConfirming(true);
    else onClose();
  }
  return (
    <>
      <Drawer
        opened
        onClose={close}
        title="Application registration"
        position="right"
        size="lg"
        closeOnClickOutside={false}
        closeButtonProps={{ 'aria-label': 'Close application editor' }}
        withCloseButton={!status.busy}
        closeOnEscape={!status.busy}
      >
        <RegistrationEditor
          client={editor.client}
          session={session}
          onSaved={onSaved}
          onRevoked={() => {
            onSaved();
            onClose();
          }}
          onStatusChange={setStatus}
        />
      </Drawer>
      {confirming && (
        <DiscardDialog
          onKeep={() => setConfirming(false)}
          onDiscard={onClose}
        />
      )}
    </>
  );
}

function DiscardDialog({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      opened
      onClose={onKeep}
      title="Discard unsaved changes?"
      closeButtonProps={{ 'aria-label': 'Keep editing' }}
      centered
    >
      <Stack>
        <Text size="sm">
          Your changes have not been saved. Keep editing to preserve this draft.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onKeep}>
            Keep editing
          </Button>
          <Button color="red" onClick={onDiscard}>
            Discard changes
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
