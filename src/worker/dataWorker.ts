/**
 * Web Worker entry. Generation (the mock "server"), normalization, EMA and downsampling all run
 * here, off the main thread. Results that contain typed arrays are TRANSFERRED (zero-copy), so the
 * main thread receives a few thousand points per chart and never holds the 1M-point columns.
 * Each response reports how long the worker was busy (used to correct for the fact that DevTools
 * CPU throttling does not apply to workers — docs/experiments.md).
 */
import type { WorkerRequest, WorkerResponse } from '../api/protocol.ts';
import { RunStore, type ViewResult } from './store.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const store = new RunStore();

function transferablesOf(v: ViewResult): Transferable[] {
  const arrays = [v.x, v.y, ...Object.values(v.buckets)];
  if (v.ema) arrays.push(v.ema.x, v.ema.y);
  return arrays.map((a) => a.buffer);
}

scope.onmessage = (e) => {
  const msg = e.data;
  const t0 = performance.now();
  try {
    let result: unknown;
    let transfer: Transferable[] = [];
    if (msg.type === 'list') result = store.list();
    else if (msg.type === 'load') result = store.load(msg.runId);
    else {
      const v = store.view(msg.req);
      result = v;
      transfer = transferablesOf(v);
    }
    scope.postMessage({ id: msg.id, ok: true, result, workerMs: performance.now() - t0 }, transfer);
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === 'number' ? (err as { status: number }).status : 500;
    scope.postMessage({ id: msg.id, ok: false, error: { message: err instanceof Error ? err.message : String(err), status }, workerMs: performance.now() - t0 }, []);
  }
};
