/** Promise-based RPC to the data worker, with AbortSignal support. */
import { PERF } from '../perf/marks.ts';
import type { WorkerCall, WorkerResponse } from './protocol.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const abortError = () => new DOMException('The request was aborted', 'AbortError');

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

/** For perf runs: total worker busy time of responses received before the first chart draw. */
function recordWorkerTime(ms: number) {
  if (!PERF || performance.getEntriesByName('chart:first-draw', 'mark').length > 0) return;
  const w = window as unknown as { __perf?: { workerMs: number } };
  w.__perf ??= { workerMs: 0 };
  w.__perf.workerMs += ms;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../worker/dataWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    recordWorkerTime(msg.workerMs);
    const p = pending.get(msg.id);
    if (!p) return; // aborted: the answer is dropped
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new ApiError(msg.error.message, msg.error.status));
  };
  return worker;
}

export function callWorker<T>(call: WorkerCall, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    signal?.addEventListener(
      'abort',
      () => {
        // The worker cannot be interrupted mid-computation; its answer is simply ignored.
        if (pending.delete(id)) reject(abortError());
      },
      { once: true },
    );
    getWorker().postMessage({ ...call, id });
  });
}
