interface Session {
  csrf: string;
  operator: boolean;
  setup: boolean;
  issuer: string;
  environment: string;
  subject: string;
}
interface Client {
  revision: number;
  desired: Record<string, string | string[]>;
  id: string;
  config: Record<string, string | string[]>;
  revoked: boolean;
  expires_at: string;
}
let session: Session;
let editingRevision = 0;
let editing = `app-${crypto.randomUUID()}`;
function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function notice(value: string) {
  element('notice').textContent = value;
}
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': session?.csrf ?? '',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
function handle(action: () => Promise<void>) {
  return () => {
    notice('');
    void action().catch((error: unknown) =>
      notice(error instanceof Error ? error.message : 'Request failed')
    );
  };
}
function edit(client: Client) {
  const form = element<HTMLFormElement>('registration');
  editing = client.id;
  editingRevision = client.revision;
  for (const [key, value] of Object.entries(client.config)) {
    const input = form.elements.namedItem(key) as HTMLInputElement;
    if (input) input.value = Array.isArray(value) ? value.join('\n') : value;
  }
  (form.elements.namedItem('expiresAt') as HTMLInputElement).value = new Date(
    Date.now() + 86400_000
  )
    .toISOString()
    .slice(0, 16);
  element('editor-title').textContent = `Edit ${client.id}`;
}
async function clients() {
  const list = element('clients');
  list.replaceChildren();
  for (const client of (await api('/api/clients')) as Client[]) {
    const pending = !client.config;
    client.config ??= client.desired;
    const row = document.createElement('div');
    row.className = 'client';
    const text = document.createElement('span');
    text.textContent = `${String(client.config['name'])} · ${String(client.config['environment'])} · ${pending ? 'pending' : client.revoked ? 'revoked' : new Date(client.expires_at) < new Date() ? 'expired' : 'active'}`;
    const button = document.createElement('button');
    button.textContent = 'Edit';
    button.onclick = () => edit(client);
    const revoke = document.createElement('button');
    revoke.textContent = 'Revoke';
    revoke.onclick = handle(async () => {
      await api(`/api/clients/${client.id}`, 'DELETE');
      await clients();
    });
    row.append(text, button, revoke);
    list.append(row);
  }
}
async function start() {
  const response = await fetch('/api/session');
  if (response.status === 401) {
    element('signed-out').hidden = false;
    return;
  }
  if (!response.ok) throw new Error('Relay unavailable');
  session = (await response.json()) as Session;
  element('signed-in').hidden = false;
  element('identity').textContent =
    `${session.environment} · ${session.subject}`;
  element('setup').hidden = session.operator || !session.setup;
  if (!session.operator) {
    element('access-denied').hidden = session.setup;
    element('access-subject').textContent = session.subject;
    return;
  }
  element('console').hidden = false;
  const environments =
    session.environment === 'production'
      ? ['production']
      : ['localhost', 'development', 'staging', 'preview', 'ci'];
  element<HTMLSelectElement>('environment').replaceChildren(
    ...environments.map((name) => new Option(name, name))
  );
  await clients();
}
element<HTMLFormElement>('setup-form').onsubmit = (event) => {
  event.preventDefault();
  handle(async () => {
    await api('/api/setup', 'POST', {
      token: element<HTMLInputElement>('setup-token').value,
    });
    location.reload();
  })();
};
element<HTMLFormElement>('registration').onsubmit = (event) => {
  event.preventDefault();
  handle(async () => {
    const form = new FormData(element<HTMLFormElement>('registration'));
    const body = {
      name: String(form.get('name')),
      project: String(form.get('project')),
      environment: String(form.get('environment')),
      instance: String(form.get('instance')),
    };
    const callbacks = String(form.get('callbacks'))
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean);
    const expiresAt = new Date(String(form.get('expiresAt'))).toISOString();
    const saved = await api(`/api/clients/${editing}`, 'PUT', {
      revision: editingRevision,
      ...body,
      callbacks,
      expiresAt,
    });
    editingRevision = saved.revision;
    element('settings').textContent =
      `OIDC_ISSUER=${session.issuer}\nOIDC_CLIENT_ID=${editing}\nOIDC_REDIRECT_URI=${callbacks[0]}\nUse authorization code + S256 PKCE, state and nonce.`;
    await clients();
  })();
};
element('new-client').onclick = () => {
  editingRevision = 0;
  editing = `app-${crypto.randomUUID()}`;
  element<HTMLFormElement>('registration').reset();
  element('editor-title').textContent = 'Register an application';
};
element('logout').onclick = handle(async () => {
  await api('/api/logout', 'POST');
  location.reload();
});
element<HTMLFormElement>('operator-form').onsubmit = (event) => {
  event.preventDefault();
  handle(async () => {
    await api('/api/operators', 'POST', {
      subject: element<HTMLInputElement>('operator-subject').value,
    });
    notice('Operator added');
  })();
};
void start().catch(() => {
  element('unavailable').hidden = false;
});
