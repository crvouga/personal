import { Icon } from '../components/icon';
import { BareShell } from '../layout';

export function LoginPage(props: { next: string; error: string | null }) {
  return (
    <BareShell title="Sign in">
      <div class="mb-6 flex items-center gap-3">
        <span class="grid size-10 place-items-center rounded-xl bg-accent text-white">
          <Icon name="server" class="size-5" />
        </span>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Sign in to Fleet
          </h1>
          <p class="text-sm text-fg-2">Use the account you use for Vault.</p>
        </div>
      </div>
      <form method="post" action="/login" class="card card-pad space-y-4">
        {props.error === null ? null : (
          <p
            role="alert"
            class="flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm font-medium text-bad"
          >
            <Icon name="alert" />
            {props.error}
          </p>
        )}
        <input type="hidden" name="next" value={props.next} />
        <div>
          <label class="label" for="login-username">
            Username
          </label>
          <input
            id="login-username"
            name="username"
            class="field"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
            autofocus
          />
        </div>
        <div>
          <label class="label" for="login-password">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            class="field"
            autocomplete="current-password"
            required
          />
        </div>
        <button type="submit" class="btn btn-primary w-full">
          Sign in
        </button>
      </form>
    </BareShell>
  );
}
