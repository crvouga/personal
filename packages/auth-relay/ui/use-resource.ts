import { useCallback, useEffect, useState } from 'react';
import { request } from './api';
import { errorMessage, type Session } from './model';

export function useResource<T>(path: string, session: Session) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void request<T>(path, session)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, session, version]);
  return { data, error, loading, reload };
}
