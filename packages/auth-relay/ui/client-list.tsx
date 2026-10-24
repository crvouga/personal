import {
  Badge,
  Button,
  Center,
  Group,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconApps, IconArrowUpRight, IconSearch } from '@tabler/icons-react';
import { clientStatus, statusColors, type Client } from './model';

export function ClientList({
  clients,
  empty,
  onCreate,
  onEdit,
}: {
  clients: Client[];
  empty: boolean;
  onCreate: () => void;
  onEdit: (client: Client) => void;
}) {
  if (!clients.length)
    return (
      <Center py={50}>
        <Stack align="center" gap="sm">
          <ThemeIcon variant="light" color="gray" size={52} radius="xl">
            {empty ? <IconApps size={26} /> : <IconSearch size={26} />}
          </ThemeIcon>
          <Text fw={650}>
            {empty
              ? 'Connect your first application'
              : 'No matching applications'}
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            {empty
              ? 'Register an exact callback URL to get your OIDC connection settings.'
              : 'Try another name, project, or status.'}
          </Text>
          {empty && (
            <Button variant="light" mt="xs" onClick={onCreate}>
              New application
            </Button>
          )}
        </Stack>
      </Center>
    );
  return (
    <Table.ScrollContainer minWidth={720}>
      <Table verticalSpacing="md" horizontalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {['Application', 'Environment', 'Status', 'Expires', ''].map(
              (label) => (
                <Table.Th key={label}>
                  {label || (
                    <Text span size="xs">
                      Manage
                    </Text>
                  )}
                </Table.Th>
              )
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {clients.map((client) => (
            <ClientRow key={client.id} client={client} onEdit={onEdit} />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function ClientRow({
  client,
  onEdit,
}: {
  client: Client;
  onEdit: (client: Client) => void;
}) {
  const config = client.config ?? client.desired;
  const status = clientStatus(client);
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={36} radius="md" variant="light" color="gray">
            <IconApps size={18} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {config.name}
            </Text>
            <Text size="xs" c="dimmed">
              {config.project} / {config.instance}
            </Text>
          </Stack>
        </Group>
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color="gray" tt="none">
          {config.environment}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge color={statusColors[status]} variant="dot" tt="none">
          {status}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text
          size="sm"
          c="dimmed"
          title={new Date(client.expires_at).toLocaleString()}
        >
          {new Date(client.expires_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </Table.Td>
      <Table.Td>
        <Button
          variant="subtle"
          size="xs"
          rightSection={<IconArrowUpRight size={15} />}
          onClick={() => onEdit(client)}
          aria-label={`Manage ${config.name}`}
        >
          Manage
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}
