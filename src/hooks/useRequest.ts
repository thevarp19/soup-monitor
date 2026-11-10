/**
 * Data fetching that cannot show the wrong run.
 *
 *  1. AbortController: a superseded request is cancelled (saves work, lets the API stop early);
 *  2. the essential guard: when a response arrives, it may write state only if it belongs to the
 *     latest request (request id; the aborted flag is checked too and is equivalent here).
 *     Relying on the fetcher to reject on abort is NOT enough — a fetcher may ignore the signal or
 *     have resolved already. The tests use fetchers that ignore the signal on purpose.
 * State is derived at render time from `settled.key/attempt` vs the current key/attempt, so a key
 * change shows "loading" immediately — the previous run's data is never rendered under the new id.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface RequestState<T> {
  key: string;
  status: 'loading' | 'success' | 'error';
  data: T | null;
  error: unknown;
  /** Which key `data` belongs to (differs from `key` only with keepPrevious while loading). */
  dataKey: string | null;
  /** Date.now() of the last successful or failed response for this key. */
  fetchedAt: number | null;
  retry: () => void;
}

export interface RequestOptions {
  /**
   * Keep showing the last successful data (of ANY key) while a new key loads — for chart views,
   * where stretched old data during a zoom is better than a blank chart. `dataKey` tells which
   * request the data answers. Never use it for "which run is this": that must not leak across keys.
   */
  keepPrevious?: boolean;
}

interface Settled<T> {
  key: string;
  attempt: number;
  status: 'success' | 'error';
  data: T | null;
  error: unknown;
  fetchedAt: number;
}

export function useRequest<T>(
  key: string,
  fetcher: (key: string, signal: AbortSignal) => Promise<T>,
  { keepPrevious = false }: RequestOptions = {},
): RequestState<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [lastGood, setLastGood] = useState<{ key: string; data: T } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    const id = ++latest.current;
    const ctrl = new AbortController();
    const settle = (s: Omit<Settled<T>, 'key' | 'attempt' | 'fetchedAt'>) => {
      if (latest.current !== id || ctrl.signal.aborted) return;
      setSettled({ ...s, key, attempt, fetchedAt: Date.now() });
      if (s.status === 'success') setLastGood({ key, data: s.data as T });
    };
    fetcherRef.current(key, ctrl.signal).then(
      (data) => settle({ status: 'success', data, error: null }),
      (error: unknown) => settle({ status: 'error', data: null, error }),
    );
    return () => ctrl.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (settled && settled.key === key && settled.attempt === attempt) {
    return { ...settled, dataKey: settled.status === 'success' ? key : null, retry };
  }
  // Loading. A retry/refresh of the SAME key keeps the last good data visible; a new key does so
  // only with keepPrevious.
  const sameKey = settled !== null && settled.key === key;
  const shown = lastGood && (keepPrevious || lastGood.key === key) ? lastGood : null;
  return {
    key,
    status: 'loading',
    data: shown ? shown.data : null,
    dataKey: shown ? shown.key : null,
    error: null,
    fetchedAt: sameKey ? settled.fetchedAt : null,
    retry,
  };
}
