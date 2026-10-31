/** Read-only deployment log observations. OpenTofu owns every Railway mutation. */
export const logsQuery = `query Logs($deploymentId: String!, $limit: Int!) {
  buildLogs(deploymentId: $deploymentId, limit: $limit) { timestamp severity message }
  deploymentLogs(deploymentId: $deploymentId, limit: $limit) { timestamp severity message }
}`;

/** Best-effort build and runtime log tails for a failed deployment; never throws. */
export async function readDeploymentLogTail(
  input: { deploymentId: string; token: string; limit?: number },
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
): Promise<string[]> {
  try {
    const response = await request('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: logsQuery,
        variables: { deploymentId: input.deploymentId, limit: input.limit ?? 40 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const result = await response.json() as {
      data?: Partial<Record<'deploymentLogs' | 'buildLogs', { timestamp: string; severity?: string; message: string }[]>>;
    };
    return (['buildLogs', 'deploymentLogs'] as const).flatMap((kind) => (result.data?.[kind] ?? []).map(
      // Neutralize workflow commands embedded in application output.
      (line) => `${kind}: ${line.timestamp} ${line.severity ?? ''} ${line.message}`.replaceAll('::', ': :'),
    ));
  } catch {
    return [];
  }
}
