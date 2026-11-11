/**
 * NAIVE BASELINE — kept on purpose for before/after measurements (`?impl=naive`).
 * What a straightforward first version does: the "server" (generator) runs on the main thread,
 * and the response is an array of row objects, as JSON.parse of a row-oriented API would return.
 */
import { generateRun } from '../core/generate.ts';
import { RUN_SPECS } from '../core/runSpecs.ts';
import { parseApiOptions } from '../api/options.ts';
import { markOnce } from '../perf/marks.ts';

export interface NaiveRow {
  step: number;
  loss: number;
  lr: number;
  grad_norm: number;
}

// The mock server's latency switches (?latency=…) are shared with the real UI, so the same request
// race can be reproduced on both (e2e/race.spec.ts).
const latency = (endpoint: string) => parseApiOptions(window.location.search).latencyFor(endpoint, Math.random);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function naiveFetchRuns() {
  await delay(latency('list'));
  return RUN_SPECS.map(({ id, name, status }) => ({ id, name, status }));
}

export async function naiveFetchRun(id: string): Promise<NaiveRow[]> {
  await delay(latency(id));
  const spec = RUN_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`404: run "${id}" not found`);
  if (spec.serverError) throw new Error('500: internal server error');
  const { raw } = generateRun(spec);
  const rows: NaiveRow[] = [];
  for (let i = 0; i < raw.step.length; i++) {
    rows.push({ step: raw.step[i], loss: raw.loss[i], lr: raw.lr[i], grad_norm: raw.grad_norm[i] });
  }
  markOnce('data:received');
  return rows;
}
