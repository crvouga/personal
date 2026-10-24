import { useEffect } from 'react';

export interface DraftStatus {
  dirty: boolean;
  busy: boolean;
}

export function useDraftStatus(
  status: DraftStatus,
  onChange: (status: DraftStatus) => void
) {
  const { dirty, busy } = status;
  useEffect(() => {
    onChange({ dirty, busy });
  }, [dirty, busy, onChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty || busy) window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);
}
