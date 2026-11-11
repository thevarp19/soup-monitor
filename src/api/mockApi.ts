/**
 * Mock API with realistic failure modes: latency (random 100–1500 ms by default, so request races
 * happen), HTTP 500 for the `server-error` run and for anything listed in ?fail=, 404 for unknown
 * runs. The "server" work (generation) and the client-side normalization run in the worker.
 */
import type { RunDetails, RunListItem, ViewRequest, ViewResult } from '../worker/store.ts';
import { RUN_SPECS } from '../core/runSpecs.ts';
import { parseApiOptions } from './options.ts';
import { abortError, ApiError, callWorker } from './workerClient.ts';

export { ApiError };

const options = () => parseApiOptions(window.location.search);
const requestCount = new Map<string, number>();
const nth = (endpoint: string) => {
  const n = (requestCount.get(endpoint) ?? 0) + 1;
  requestCount.set(endpoint, n);
  return n;
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export async function fetchRuns({ signal }: { signal?: AbortSignal } = {}): Promise<RunListItem[]> {
  const o = options();
  await delay(o.latencyFor('list', Math.random), signal);
  if (o.fails('list', nth('list'))) throw new ApiError('HTTP 500: the run list could not be loaded', 500);
  return callWorker<RunListItem[]>({ type: 'list' }, signal);
}

export async function fetchRun(id: string, { signal }: { signal?: AbortSignal } = {}): Promise<RunDetails> {
  const o = options();
  await delay(o.latencyFor(id, Math.random), signal);
  if (RUN_SPECS.find((s) => s.id === id)?.serverError || o.fails(id, nth(id))) {
    throw new ApiError(`HTTP 500: the data for run "${id}" could not be loaded`, 500);
  }
  return callWorker<RunDetails>({ type: 'load', runId: id }, signal);
}

/** Downsampled view for the visible range — a local computation in the worker, no API latency. */
export function fetchView(req: ViewRequest, { signal }: { signal?: AbortSignal } = {}): Promise<ViewResult> {
  return callWorker<ViewResult>({ type: 'view', req }, signal);
}
