import {
  Alert,
  Checkbox,
  Divider,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';

export interface EditorValues {
  name: string;
  project: string;
  environment: string;
  instance: string;
  callbacks: string;
  expiresAt: string;
  ownership: boolean;
}
type FieldsProps = {
  form: UseFormReturnType<EditorValues>;
  immutable: boolean;
  production: boolean;
};

export function RegistrationFields(props: FieldsProps) {
  return (
    <Stack gap="lg">
      <IdentityFields {...props} />
      <Divider />
      <ConnectionFields form={props.form} production={props.production} />
      <Alert color="indigo" variant="light">
        <Text size="xs">
          Use a separate instance for each local server or preview. Removed
          callbacks have a ten-minute overlap.
        </Text>
      </Alert>
      <Checkbox
        name="ownership"
        required
        label="I verified ownership of these destinations and their application."
        {...props.form.getInputProps('ownership', { type: 'checkbox' })}
      />
    </Stack>
  );
}

function IdentityFields({ form, immutable, production }: FieldsProps) {
  return (
    <Stack gap="sm">
      <Text fw={650} size="sm">
        Application details
      </Text>
      <TextInput
        label="Name"
        name="name"
        placeholder="My application"
        required
        maxLength={80}
        {...form.getInputProps('name')}
      />
      <TextInput
        label="Project"
        name="project"
        description="A stable identifier for this project."
        placeholder="my-project"
        required
        maxLength={80}
        readOnly={immutable}
        {...form.getInputProps('project')}
      />
      <SimpleGrid cols={{ base: 1, xs: 2 }}>
        <NativeSelect
          label="Environment"
          name="environment"
          data={
            production
              ? ['production']
              : ['localhost', 'development', 'staging', 'preview', 'ci']
          }
          disabled={immutable}
          {...form.getInputProps('environment')}
        />
        <TextInput
          label="Instance"
          name="instance"
          placeholder="primary"
          required
          maxLength={80}
          readOnly={immutable}
          {...form.getInputProps('instance')}
        />
      </SimpleGrid>
      {immutable && (
        <Text size="xs" c="dimmed">
          Project, environment, and instance are fixed. Create another
          application for a different identity.
        </Text>
      )}
    </Stack>
  );
}

function ConnectionFields({
  form,
  production,
}: Pick<FieldsProps, 'form' | 'production'>) {
  return (
    <Stack gap="sm">
      <Text fw={650} size="sm">
        Connection & lifetime
      </Text>
      <Textarea
        label="Exact callback URLs (one per line)"
        description="Include the scheme, host, port, and callback path. Wildcards are not supported."
        name="callbacks"
        autosize
        minRows={3}
        maxRows={8}
        required
        placeholder={
          production
            ? 'https://app.example.com/auth/callback'
            : 'http://localhost:5173/callback'
        }
        {...form.getInputProps('callbacks')}
      />
      <TextInput
        label="Expires at"
        description={`Your local time. Maximum ${production ? '366 days' : '7 days'}; renew before expiry.`}
        type="datetime-local"
        name="expiresAt"
        required
        {...form.getInputProps('expiresAt')}
      />
    </Stack>
  );
}
