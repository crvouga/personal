import { registry, type Selection } from './registry';
import { proxyKey } from './secrets';

export async function verifyProvider(selection: Selection, smoke: boolean) {
  if (selection.profile !== 'proxy')
    return {
      static: 'pass',
      reachability: 'unverified',
      authenticatedModels: 'unverified',
      inference: 'unverified',
      streaming: 'unverified',
      toolCalls: 'unverified',
      t3EndToEnd: 'unverified',
    };
  const key = await proxyKey();
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const response = await fetch(registry.proxy.endpoint + '/v1/models', {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      'Proxy model listing failed; inspect endpoint/authentication locally.'
    );
  const data = (await response.json()) as { data?: Array<{ id: string }> };
  if (!data.data?.some((model) => model.id === selection.model))
    throw new Error(
      'Approved model is unavailable; review registry model selection.'
    );
  let inference = 'unverified';
  if (smoke) {
    const messages = selection.tool === 'claude';
    const body = messages
      ? {
          model: selection.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply OK.' }],
        }
      : { model: selection.model, max_output_tokens: 16, input: 'Reply OK.' };
    const result = await fetch(
      registry.proxy.endpoint + (messages ? '/v1/messages' : '/v1/responses'),
      {
        method: 'POST',
        headers: { ...headers, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!result.ok)
      throw new Error(
        'Bounded inference request failed; no response body is logged.'
      );
    await validateOutput(result, messages);
    inference = 'pass';
  }
  return {
    static: 'pass',
    reachability: 'pass',
    authenticatedModels: 'pass',
    inference,
    streaming: 'unverified',
    toolCalls: 'unverified',
    t3EndToEnd: 'unverified',
  };
}

async function validateOutput(
  result: Response,
  messages: boolean
): Promise<void> {
  const payload = (await result.json()) as {
    content?: unknown[];
    output?: unknown[];
    error?: unknown;
  };
  const output = messages ? payload.content : payload.output;
  if (payload.error || !Array.isArray(output) || output.length === 0)
    throw new Error(
      'Inference returned no output; inspect the provider locally.'
    );
}
