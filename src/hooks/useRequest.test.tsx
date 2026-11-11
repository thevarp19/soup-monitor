// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRequest } from './useRequest.ts';

/** A promise we resolve by hand, so the test decides which response arrives first. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useRequest — latest request wins', () => {
  it('A → B, B answers first, A answers later: the screen keeps B', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const signals = new Map<string, AbortSignal>();
    const fetcher = (id: string, signal: AbortSignal) => {
      const d = deferred<string>();
      pending.set(id, d);
      signals.set(id, signal);
      return d.promise;
    };
    const { result, rerender } = renderHook(({ id }) => useRequest(id, fetcher), { initialProps: { id: 'A' } });
    expect(result.current.status).toBe('loading');

    rerender({ id: 'B' });
    expect(signals.get('A')?.aborted).toBe(true); // the old request is cancelled

    await act(async () => pending.get('B')?.resolve('data of B'));
    expect(result.current).toMatchObject({ status: 'success', data: 'data of B', key: 'B' });

    await act(async () => pending.get('A')?.resolve('data of A')); // late answer for A
    expect(result.current).toMatchObject({ status: 'success', data: 'data of B', key: 'B' });
  });

  it('A → B → A: the second A is a new request; the first A’s late answer is ignored', async () => {
    const calls: Array<{ id: string; d: ReturnType<typeof deferred<string>> }> = [];
    const fetcher = (id: string) => {
      const d = deferred<string>();
      calls.push({ id, d });
      return d.promise;
    };
    const { result, rerender } = renderHook(({ id }) => useRequest(id, fetcher), { initialProps: { id: 'A' } });
    rerender({ id: 'B' });
    rerender({ id: 'A' });
    expect(calls.map((c) => c.id)).toEqual(['A', 'B', 'A']);

    await act(async () => calls[0].d.resolve('stale A')); // the FIRST request for A
    expect(result.current.status).toBe('loading');
    await act(async () => calls[1].d.resolve('B'));
    expect(result.current.status).toBe('loading');
    await act(async () => calls[2].d.resolve('fresh A'));
    expect(result.current).toMatchObject({ status: 'success', data: 'fresh A', key: 'A' });
  });

  it('an error of an outdated request does not replace the current state', async () => {
    const ds = new Map<string, ReturnType<typeof deferred<string>>>();
    const fetcher = (id: string) => {
      const d = deferred<string>();
      ds.set(id, d);
      return d.promise;
    };
    const { result, rerender } = renderHook(({ id }) => useRequest(id, fetcher), { initialProps: { id: 'A' } });
    rerender({ id: 'B' });
    await act(async () => ds.get('B')?.resolve('B'));
    await act(async () => ds.get('A')?.reject(new Error('500 for A')));
    expect(result.current).toMatchObject({ status: 'success', data: 'B' });
  });

  it('shows the error of the current request, and retry() fetches again', async () => {
    let attempt = 0;
    const fetcher = () => (++attempt === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok'));
    const { result } = renderHook(() => useRequest('A', fetcher));
    await act(async () => {});
    expect(result.current).toMatchObject({ status: 'error' });
    expect(String(result.current.error)).toContain('boom');
    await act(async () => result.current.retry());
    expect(result.current).toMatchObject({ status: 'success', data: 'ok' });
  });

  it('records when the data was fetched', async () => {
    const { result } = renderHook(() => useRequest('A', () => Promise.resolve('x')));
    await act(async () => {});
    expect(typeof result.current.fetchedAt).toBe('number');
  });

  it('keepPrevious: while a new key loads, the last data stays visible and dataKey says which key it belongs to', async () => {
    const ds = new Map<string, ReturnType<typeof deferred<string>>>();
    const fetcher = (id: string) => {
      const d = deferred<string>();
      ds.set(id, d);
      return d.promise;
    };
    const { result, rerender } = renderHook(({ id }) => useRequest(id, fetcher, { keepPrevious: true }), { initialProps: { id: 'range-1' } });
    await act(async () => ds.get('range-1')?.resolve('view 1'));
    rerender({ id: 'range-2' });
    expect(result.current).toMatchObject({ status: 'loading', key: 'range-2', data: 'view 1', dataKey: 'range-1' });
    await act(async () => ds.get('range-2')?.resolve('view 2'));
    expect(result.current).toMatchObject({ status: 'success', data: 'view 2', dataKey: 'range-2' });
  });

  it('without keepPrevious a new key never shows the previous key’s data', async () => {
    const { result, rerender } = renderHook(({ id }) => useRequest(id, (k) => (k === 'A' ? Promise.resolve('A') : new Promise<string>(() => {}))), { initialProps: { id: 'A' } });
    await act(async () => {});
    rerender({ id: 'B' });
    expect(result.current).toMatchObject({ status: 'loading', data: null, dataKey: null });
  });

  it('a failed refresh of the same key keeps the last good data, reports the error, and keeps lastSuccessAt', async () => {
    let n = 0;
    const fetcher = () => (++n === 1 ? Promise.resolve('v1') : Promise.reject(new Error('HTTP 500')));
    const { result } = renderHook(() => useRequest('live', fetcher));
    await act(async () => {});
    const firstSuccess = result.current.lastSuccessAt;
    expect(typeof firstSuccess).toBe('number');
    await act(async () => result.current.retry());
    expect(result.current).toMatchObject({ status: 'error', data: 'v1', dataKey: 'live' });
    expect(String(result.current.error)).toContain('HTTP 500');
    expect(result.current.lastSuccessAt).toBe(firstSuccess);
  });
});

