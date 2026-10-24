import { useState } from 'react';
import {
  Button,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconRefresh, IconSearch } from '@tabler/icons-react';
import { clientStatus, type Client } from './model';
import type { useResource } from './use-resource';
import { ClientList } from './client-list';

type DirectoryProps = {
  resource: ReturnType<typeof useResource<Client[]>>;
  onCreate: () => void;
  onEdit: (client: Client) => void;
};

export function ApplicationDirectory({
  resource,
  onCreate,
  onEdit,
}: DirectoryProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>('All statuses');
  const clients = resource.data ?? [];
  const filtered = clients.filter((client) => {
    const config = client.config ?? client.desired;
    return (
      `${config.name} ${config.project} ${config.environment} ${config.instance} ${client.id}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === 'All statuses' || clientStatus(client) === status)
    );
  });
  return (
    <Paper withBorder p="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Text fw={650}>Application directory</Text>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconRefresh size={15} />}
            onClick={resource.reload}
            loading={resource.loading}
          >
            Refresh
          </Button>
        </Group>
        <DirectoryFilters
          search={search}
          status={status}
          setSearch={setSearch}
          setStatus={setStatus}
        />
        {resource.loading && !resource.data ? (
          <Stack>
            {[1, 2, 3].map((key) => (
              <Skeleton key={key} height={70} />
            ))}
          </Stack>
        ) : (
          resource.data && (
            <ClientList
              clients={filtered}
              empty={clients.length === 0}
              onCreate={onCreate}
              onEdit={onEdit}
            />
          )
        )}
        {resource.data && (
          <Text size="xs" c="dimmed">
            {filtered.length} of {clients.length} applications · Changes take
            effect without a deployment.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function DirectoryFilters({
  search,
  status,
  setSearch,
  setStatus,
}: {
  search: string;
  status: string | null;
  setSearch: (value: string) => void;
  setStatus: (value: string | null) => void;
}) {
  return (
    <Group align="end">
      <TextInput
        flex={1}
        miw={180}
        aria-label="Search applications"
        placeholder="Search by name, project, or instance…"
        leftSection={<IconSearch size={17} />}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <Select
        aria-label="Filter by status"
        data={['All statuses', 'Active', 'Pending', 'Expired', 'Revoked']}
        value={status}
        onChange={setStatus}
        allowDeselect={false}
        w={160}
      />
    </Group>
  );
}
