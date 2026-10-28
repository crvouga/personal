export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type Ready = {
  readonly ready: boolean;
  readonly bootstrapRequired: boolean;
};
export type Installation = {
  id: string;
  installation_id: number;
  target: string;
};
export type Pool = { id: string; name: string; installation_id: string };
export type JoinToken = {
  token: string;
  expires_at: string;
  command: string;
  commands: { linux: string; windows: string };
};

/** Typed subset of the Zoomies REST API; bearer token only, never logged. */
export class ZoomiesApi {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly fetcher: FetchLike = fetch
  ) {}

  async ready(): Promise<Ready> {
    try {
      const response = await this.fetcher(`${this.origin}/readyz`);
      const body = (await response.json().catch(() => ({}))) as {
        bootstrap_required?: boolean;
      };
      return {
        ready: response.ok,
        bootstrapRequired: body.bootstrap_required ?? false,
      };
    } catch {
      return { ready: false, bootstrapRequired: false };
    }
  }

  async installations(): Promise<readonly Installation[]> {
    return (
      await this.call<{ items: Installation[] }>('GET', '/api/v1/installations')
    ).items;
  }

  createInstallation(body: Record<string, unknown>): Promise<Installation> {
    return this.call('POST', '/api/v1/installations', body);
  }

  async pools(): Promise<readonly Pool[]> {
    return (await this.call<{ items: Pool[] }>('GET', '/api/v1/pools')).items;
  }

  createPool(body: Record<string, unknown>): Promise<Pool> {
    return this.call('POST', '/api/v1/pools', body);
  }

  createJoinToken(body: Record<string, unknown>): Promise<JoinToken> {
    return this.call('POST', '/api/v1/join-tokens', body);
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      // Error bodies name the offending field, never a credential.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(
        `${method} ${path} failed with ${response.status}${detail ? `: ${detail}` : ''}`
      );
    }
    return (await response.json()) as T;
  }
}
