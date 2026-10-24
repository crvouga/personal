import { useCallback, useEffect, useState } from 'react';
import { decodeState, messageOf, type ConsoleState } from './model';
export function useConsoleResource(path: string) {
  const [data, setData] = useState<ConsoleState>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/ui/state?${new URLSearchParams({ path, next: new URLSearchParams(path.split('?')[1]).get('next') ?? '/', error: new URLSearchParams(path.split('?')[1]).get('error') ?? '' })}`,
          { credentials: 'same-origin' }
        );
        if (!response.ok && response.status !== 401)
          throw new Error('Fleet is unavailable. Try again shortly.');
        const next = decodeState(await response.text());
        if (active) {
          setData(next);
          setError('');
        }
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!paused && !document.hidden) void load();
    }, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, version, paused]);
  return { data, error, loading, paused, setPaused, reload };
}
