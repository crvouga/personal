import { Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { clientStatus, type Client } from './model';

export function ClientStats({
  clients,
  loading,
}: {
  clients: Client[];
  loading: boolean;
}) {
  const stats = [
    {
      label: 'Total applications',
      value: clients.length,
      description: 'Across this relay environment',
    },
    {
      label: 'Active connections',
      value: clients.filter((client) => clientStatus(client) === 'Active')
        .length,
      description: 'Ready for new sign-ins',
    },
    {
      label: 'Needs attention',
      value: clients.filter((client) =>
        ['Pending', 'Expired'].includes(clientStatus(client))
      ).length,
      description: 'Pending or expired registrations',
    },
  ];
  return (
    <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md">
      {stats.map((stat) => (
        <Paper withBorder p="lg" key={stat.label}>
          <Stack gap={5}>
            <Text size="sm" c="dimmed">
              {stat.label}
            </Text>
            {loading ? (
              <Skeleton height={34} width={45} />
            ) : (
              <Text size="30px" fw={700} lh={1.3}>
                {stat.value}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {stat.description}
            </Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
