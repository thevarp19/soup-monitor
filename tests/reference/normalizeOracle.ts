/**
 * Reference ("oracle") implementation of normalization, used only by tests.
 *
 * Written to be obviously correct rather than fast: array of row objects, a Map for
 * last-write-wins, Array.prototype.sort, plain loops. It shares no code with src/core/normalize.ts,
 * so the optimized implementation is checked against an independent derivation.
 * Policy (must match the README): rows with a non-finite step are dropped; for duplicate steps the
 * last row in log order wins; NaN/±Inf values are kept; a gap is a spacing > gapFactor × median
 * spacing of the unique sorted steps.
 */
import type { Columns, Metric } from '../../src/core/types.ts';

const METRICS: Metric[] = ['loss', 'lr', 'grad_norm'];

interface Row {
  step: number;
  loss: number;
  lr: number;
  grad_norm: number;
}

export interface OracleResult {
  step: number[];
  loss: number[];
  lr: number[];
  grad_norm: number[];
  gapStarts: number[];
  duplicateIndex: number[];
  nonFiniteIndex: Record<Metric, number[]>;
  quality: {
    rawRows: number;
    rows: number;
    invalidStepRows: number;
    orderBreaks: number;
    duplicateSteps: number;
    overwrittenRows: number;
    overwrittenNonFinite: number;
    nonFinite: Record<Metric, { nan: number; posInf: number; negInf: number }>;
    gaps: { medianStep: number | null; threshold: number | null; ranges: Array<{ fromStep: number; toStep: number }> };
  };
}

export function normalizeOracle(raw: Columns, gapFactor = 1.5): OracleResult {
  const rows: Row[] = [];
  for (let i = 0; i < raw.step.length; i++) {
    rows.push({ step: raw.step[i], loss: raw.loss[i], lr: raw.lr[i], grad_norm: raw.grad_norm[i] });
  }

  const valid = rows.filter((r) => Number.isFinite(r.step));

  let orderBreaks = 0;
  for (let i = 1; i < valid.length; i++) if (valid[i].step < valid[i - 1].step) orderBreaks++;

  const lastByStep = new Map<number, Row>();
  const writes = new Map<number, number>();
  for (const r of valid) {
    lastByStep.set(r.step, r);
    writes.set(r.step, (writes.get(r.step) ?? 0) + 1);
  }
  const kept = new Set(lastByStep.values());
  const isNonFiniteRow = (r: Row) => METRICS.some((m) => !Number.isFinite(r[m]));
  const discarded = valid.filter((r) => !kept.has(r));

  const out = [...lastByStep.values()].sort((a, b) => a.step - b.step);

  const nonFinite = {} as OracleResult['quality']['nonFinite'];
  const nonFiniteIndex = {} as OracleResult['nonFiniteIndex'];
  for (const m of METRICS) {
    nonFinite[m] = { nan: 0, posInf: 0, negInf: 0 };
    nonFiniteIndex[m] = [];
    out.forEach((r, i) => {
      const v = r[m];
      if (Number.isNaN(v)) nonFinite[m].nan++;
      else if (v === Infinity) nonFinite[m].posInf++;
      else if (v === -Infinity) nonFinite[m].negInf++;
      else return;
      nonFiniteIndex[m].push(i);
    });
  }

  let medianStep: number | null = null;
  let threshold: number | null = null;
  const gapStarts: number[] = [];
  const ranges: Array<{ fromStep: number; toStep: number }> = [];
  if (out.length >= 2) {
    const deltas = out.slice(1).map((r, i) => r.step - out[i].step);
    const sorted = [...deltas].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianStep = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const limit = gapFactor * medianStep;
    threshold = limit;
    deltas.forEach((d, i) => {
      if (d > limit) {
        gapStarts.push(i + 1);
        ranges.push({ fromStep: out[i].step, toStep: out[i + 1].step });
      }
    });
  }

  return {
    step: out.map((r) => r.step),
    loss: out.map((r) => r.loss),
    lr: out.map((r) => r.lr),
    grad_norm: out.map((r) => r.grad_norm),
    gapStarts,
    duplicateIndex: out.flatMap((r, i) => ((writes.get(r.step) ?? 0) > 1 ? [i] : [])),
    nonFiniteIndex,
    quality: {
      rawRows: rows.length,
      rows: out.length,
      invalidStepRows: rows.length - valid.length,
      orderBreaks,
      duplicateSteps: [...writes.values()].filter((w) => w > 1).length,
      overwrittenRows: discarded.length,
      overwrittenNonFinite: discarded.filter(isNonFiniteRow).length,
      nonFinite,
      gaps: { medianStep, threshold, ranges },
    },
  };
}
