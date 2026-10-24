import type { Session } from './model';

export async function request<T>(
  path: string,
  session?: Session,
  options: { method: string; body?: unknown } = { method: 'GET' }
): Promise<T> {
  const response = await fetch(path, {
    method: options.method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': session?.csrf ?? '',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event('relay:session-expired'));
    throw new Error('Your session expired. Sign in again to continue.');
  }
  const data = (await response.json().catch(() => {
    throw new Error(
      'The relay returned an unexpected response. Please try again.'
    );
  })) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      data.error ?? 'The relay is unavailable. Please try again.'
    );
  return data;
}
