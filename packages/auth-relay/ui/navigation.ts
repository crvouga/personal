import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function usePage() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  if (hash === '#operators') return 'operators';
  if (hash === '#integration') return 'integration';
  if (hash === '#agents') return 'agents';
  return 'applications';
}
