import type { ViewRequest } from '../worker/store.ts';

export type WorkerCall = { type: 'list' } | { type: 'load'; runId: string } | { type: 'view'; req: ViewRequest };
export type WorkerRequest = WorkerCall & { id: number };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown; workerMs: number }
  | { id: number; ok: false; error: { message: string; status: number }; workerMs: number };
