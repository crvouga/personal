/** Read-only deployment observations. OpenTofu owns every Railway mutation. */
export const deploymentQuery = `query Rollout($serviceId: String!, $environmentId: String!) {
  deployments(input: {serviceId: $serviceId, environmentId: $environmentId}, first: 1) {
    edges { node { id status createdAt meta } }
  }
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    activeDeployments { id status }
  }
}`;

export type Deployment = {
  id: string;
  status: string;
  createdAt: string;
  meta: { image?: string } | null;
};
export type Rollout = {
  latest: Deployment | undefined;
  active: readonly { id: string; status: string }[];
};

export async function readDeployment(
  input: { serviceId: string; environmentId: string; token: string },
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
): Promise<Rollout> {
  const response = await request('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: deploymentQuery,
      variables: { serviceId: input.serviceId, environmentId: input.environmentId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Railway rollout query: HTTP ${response.status}`);
  const result = await response.json() as {
    errors?: unknown[];
    data?: {
      deployments?: { edges: { node: Deployment }[] };
      serviceInstance?: { activeDeployments: Rollout['active'] };
    };
  };
  if (result.errors?.length || !result.data?.deployments || !result.data.serviceInstance)
    throw new Error('Railway rollout query failed; verify deployment credentials and service access');
  return {
    latest: result.data.deployments.edges[0]?.node,
    active: result.data.serviceInstance.activeDeployments,
  };
}
