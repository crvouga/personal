import { BareShell } from '../layout';

export function LoginPage(props: {
  next: string;
  error: string | null;
  available?: boolean;
}) {
  return (
    <BareShell title="Sign in">
      <h1 class="text-2xl font-semibold tracking-tight">Sign in to Fleet</h1>
      <div class="card card-pad space-y-4">
        <p>
          Use your Google account to continue through the shared authentication
          relay.
        </p>
        {props.error ? <p role="alert">{props.error}</p> : null}
        {props.available === false ? (
          <p role="status">
            Google sign-in is unavailable until the authentication relay is
            configured. Contact your infrastructure administrator.
          </p>
        ) : (
          <a
            class="btn btn-primary w-full"
            href={`/auth/login?next=${encodeURIComponent(props.next)}`}
          >
            Continue with Google
          </a>
        )}
      </div>
    </BareShell>
  );
}

export function NotAllowedPage(props: { email: string }) {
  return (
    <BareShell title="Not allowed">
      <h1 class="text-2xl font-semibold tracking-tight">Not allowed</h1>
      <div class="card card-pad space-y-4">
        <p>
          Signed in as {props.email}. This Google account is not on Fleet’s
          access list.
        </p>
        <p>
          Ask a Fleet administrator to add your email, or sign out to use
          another account.
        </p>
        <form method="post" action="/logout">
          <button class="btn btn-primary" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </BareShell>
  );
}
