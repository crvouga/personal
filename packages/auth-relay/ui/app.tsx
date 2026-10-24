import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Center, Loader } from '@mantine/core';
import { AdminProvider, prepareAdminUi } from '@pkgs/admin-ui/provider';
import type { Session } from './model';
import { AccessRequired, SignedOut, Unavailable } from './access';
import { ConsoleShell } from './shell';
import { ConsoleContent } from './console';
prepareAdminUi();

function App() {
  const [session, setSession] = useState<Session | null>();
  const [unavailable, setUnavailable] = useState(false);
  const reload = useCallback(() => {
    setUnavailable(false);
    setSession(undefined);
    void fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.status === 401) {
          setSession(null);
          return;
        }
        if (!response.ok) throw new Error('Relay unavailable');
        setSession((await response.json()) as Session);
      })
      .catch(() => setUnavailable(true));
  }, []);
  useEffect(() => {
    reload();
    const expired = () => setSession(null);
    window.addEventListener('relay:session-expired', expired);
    return () => window.removeEventListener('relay:session-expired', expired);
  }, [reload]);
  if (unavailable) return <Unavailable retry={reload} />;
  if (session === undefined)
    return (
      <Center mih="100dvh">
        <Loader aria-label="Loading your console" />
      </Center>
    );
  if (session === null) return <SignedOut />;
  return (
    <ConsoleShell session={session}>
      {session.operator ? (
        <ConsoleContent session={session} />
      ) : (
        <AccessRequired session={session} reload={reload} />
      )}
    </ConsoleShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <AdminProvider>
    <App />
  </AdminProvider>
);
