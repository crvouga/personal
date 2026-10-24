import { Checkbox, MultiSelect, Textarea, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
export interface GrantValues {
  project: string;
  tokenHash: string;
  environments: string[];
  origins: string;
  allowLoopback: boolean;
  expiresAt: string;
  ownership: boolean;
}
export function AgentGrantFields({
  form,
  production,
  editing,
}: {
  form: UseFormReturnType<GrantValues>;
  production: boolean;
  editing: boolean;
}) {
  return (
    <>
      <TextInput
        label="Project"
        required
        disabled={editing}
        {...form.getInputProps('project')}
      />
      <TextInput
        label="Credential SHA-256 fingerprint"
        description="64 lowercase hex characters from the OpenTofu output or the agent client fingerprint command. Never paste the token."
        required
        {...form.getInputProps('tokenHash')}
      />
      <MultiSelect
        label="Allowed environments"
        data={
          production
            ? ['production']
            : ['localhost', 'development', 'staging', 'preview', 'ci']
        }
        {...form.getInputProps('environments')}
      />
      <Textarea
        label="Approved HTTPS origins"
        description="One exact origin per line, e.g. https://app.example.com. No paths, shared hosting suffixes or wildcards. Paths within these owned origins are delegated."
        {...form.getInputProps('origins')}
      />
      {!production && (
        <Checkbox
          label="Allow exact HTTP localhost and 127.0.0.1 callbacks on changing ports"
          {...form.getInputProps('allowLoopback', { type: 'checkbox' })}
        />
      )}
      <TextInput
        type="datetime-local"
        label="Grant expires"
        description={
          production
            ? 'Maximum 366 days. Registrations cannot outlive this grant.'
            : 'Maximum seven days. Registrations cannot outlive this grant.'
        }
        required
        {...form.getInputProps('expiresAt')}
      />
      <Checkbox
        label="I verified this project's ownership, credential custody and every approved origin."
        {...form.getInputProps('ownership', { type: 'checkbox' })}
      />
    </>
  );
}
