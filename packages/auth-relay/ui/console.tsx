import type { Session } from './model';
import { useEffect } from 'react';
import { useDocumentTitle } from '@mantine/hooks';
import { Applications } from './applications';
import { Operators } from './operators';
import { Integration } from './integration';
import { usePage } from './navigation';
import { AgentGrants } from './agent-grants';

export function ConsoleContent({ session }: { session: Session }) {
  const page = usePage();
  const title = {
    applications: 'Applications',
    operators: 'Operators',
    integration: 'Integration guide',
    agents: 'Agent access',
  }[page];
  useDocumentTitle(`${title} · Relay`);
  useEffect(() => {
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [page]);
  if (page === 'operators') return <Operators session={session} />;
  if (page === 'agents') return <AgentGrants session={session} />;
  if (page === 'integration') return <Integration session={session} />;
  return <Applications session={session} />;
}
