/**
 * NAIVE BASELINE — kept on purpose for before/after measurements (`?impl=naive`).
 * What a straightforward first version does: the "server" (generator) runs on the main thread,
 * and the response is an array of row objects, as JSON.parse of a row-oriented API would return.
 */
import { generateRun } from '../core/generate.ts';
import { RUN_SPECS } from '../core/runSpecs.ts';
import { markOnce } from '../perf/marks.ts';

export interface NaiveRow {
  step: number;
  loss: number;
  lr: number;
  grad_norm: number;
}

function latency(): number {
  const q = new URLSearchParams(window.location.search).get('latency');
  if (q !== null && q !== '' && Number.isFinite(Number(q))) return Number(q);
  return 100 + Math.random() * 1400;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function naiveFetchRuns() {
  await delay(latency());
  return RUN_SPECS.map(({ id, name, status }) => ({ id, name, status }));
}

export async function naiveFetchRun(id: string): Promise<NaiveRow[]> {
  await delay(latency());
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
