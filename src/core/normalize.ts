import type { Columns, Metric } from './types.ts';
import { METRICS } from './types.ts';

/** A spacing larger than this × the median spacing is a gap: the line must break there. */
export const DEFAULT_GAP_FACTOR = 1.5;

export interface NonFiniteCounts {
  nan: number;
  posInf: number;
  negInf: number;
}

export interface QualityReport {
  rawRows: number;
  /** Rows after normalization = number of distinct valid steps. */
  rows: number;
  /** Rows dropped because their step was NaN or ±Infinity (no position to draw them at). */
  invalidStepRows: number;
  /** Places in log order where the step went backwards (0 ⇔ the input was already sorted). */
  orderBreaks: number;
  /** Distinct steps that were written more than once. */
  duplicateSteps: number;
  /** Rows discarded because a later row wrote the same step. */
  overwrittenRows: number;
  /** Of those, rows that contained NaN/±Inf — e.g. a NaN that a resume-from-checkpoint "fixed". */
  overwrittenNonFinite: number;
  /** Non-finite values that ARE in the normalized series, per metric. */
  nonFinite: Record<Metric, NonFiniteCounts>;
  gaps: {
    /** Median spacing of the unique sorted steps; null with fewer than 2 rows. */
    medianStep: number | null;
    threshold: number | null;
    ranges: Array<{ fromStep: number; toStep: number }>;
  };
}

export interface NormalizedRun extends Columns {
  /** Indices i where step[i] − step[i−1] exceeds the gap threshold (break the line before i). */
  gapStarts: Uint32Array;
  /** Indices whose step had more than one write. */
  duplicateIndex: Uint32Array;
  /** Per metric, indices whose value is NaN or ±Infinity (drawn as markers, never as 0). */
  nonFiniteIndex: Record<Metric, Uint32Array>;
  quality: QualityReport;
}

export interface NormalizeOptions {
  gapFactor?: number;
}

/**
 * Turn raw rows in log order into a series that can be drawn truthfully:
 *  1. rows with a non-finite step are dropped (and counted);
 *  2. rows are sorted by step (ties broken by log order, so the sort is stable by construction);
 *  3. duplicate steps: the LAST write in log order wins (a resume from checkpoint re-logs steps and
 *     the newer values are the ones the run continued from); every overwrite is counted;
 *  4. NaN / ±Infinity values are kept as they are and indexed for markers;
 *  5. gaps: spacing > gapFactor × median spacing of the unique steps.
 * The input is never mutated.
 */
export function normalize(raw: Columns, options: NormalizeOptions = {}): NormalizedRun {
  const gapFactor = options.gapFactor ?? DEFAULT_GAP_FACTOR;
  const s = raw.step;
  const n = s.length;

  // Pass 1: valid rows, order breaks, and whether the input is already strictly increasing.
  let valid = 0;
  let orderBreaks = 0;
  let strictlyIncreasing = true;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = s[i];
    if (!Number.isFinite(v)) continue;
    if (valid > 0) {
      if (v < prev) orderBreaks++;
      if (v <= prev) strictlyIncreasing = false;
    }
    prev = v;
    valid++;
  }

  const isNonFiniteRow = (i: number) =>
    !Number.isFinite(raw.loss[i]) || !Number.isFinite(raw.lr[i]) || !Number.isFinite(raw.grad_norm[i]);

  // Pass 2: choose which raw row ends up at each output position.
  const keep = new Uint32Array(valid);
  let rows = 0;
  let duplicateSteps = 0;
  let overwrittenRows = 0;
  let overwrittenNonFinite = 0;
  const duplicateIndex: number[] = [];

  if (strictlyIncreasing) {
    // Fast path (e.g. the 1M-point run): no sort needed, no duplicates possible.
    for (let i = 0; i < n; i++) if (Number.isFinite(s[i])) keep[rows++] = i;
  } else {
    const perm = new Uint32Array(valid);
    for (let i = 0, k = 0; i < n; i++) if (Number.isFinite(s[i])) perm[k++] = i;
    perm.sort((a, b) => s[a] - s[b] || a - b);

    let k = 0;
    while (k < valid) {
      let j = k;
      while (j + 1 < valid && s[perm[j + 1]] === s[perm[k]]) j++;
      if (j > k) {
        duplicateSteps++;
        duplicateIndex.push(rows);
        overwrittenRows += j - k;
        for (let t = k; t < j; t++) if (isNonFiniteRow(perm[t])) overwrittenNonFinite++;
      }
      keep[rows++] = perm[j]; // last write in log order
      k = j + 1;
    }
  }

  const gather = (src: Float64Array) => {
    const out = new Float64Array(rows);
    for (let k = 0; k < rows; k++) out[k] = src[keep[k]];
    return out;
  };
  const step = gather(s);
  const columns: Record<Metric, Float64Array> = {
    loss: gather(raw.loss),
    lr: gather(raw.lr),
    grad_norm: gather(raw.grad_norm),
  };

  // Non-finite values per metric.
  const nonFinite = {} as Record<Metric, NonFiniteCounts>;
  const nonFiniteIndex = {} as Record<Metric, Uint32Array>;
  for (const m of METRICS) {
    const col = columns[m];
    const counts: NonFiniteCounts = { nan: 0, posInf: 0, negInf: 0 };
    const idx: number[] = [];
    for (let k = 0; k < rows; k++) {
      const v = col[k];
      if (Number.isFinite(v)) continue;
      if (Number.isNaN(v)) counts.nan++;
      else if (v > 0) counts.posInf++;
      else counts.negInf++;
      idx.push(k);
    }
    nonFinite[m] = counts;
    nonFiniteIndex[m] = Uint32Array.from(idx);
  }

  // Gaps, measured on the unique sorted steps.
  let medianStep: number | null = null;
  let threshold: number | null = null;
  const gapStarts: number[] = [];
  const ranges: Array<{ fromStep: number; toStep: number }> = [];
  if (rows >= 2) {
    const deltas = new Float64Array(rows - 1);
    for (let k = 1; k < rows; k++) deltas[k - 1] = step[k] - step[k - 1];
    const sorted = deltas.slice().sort();
    const mid = sorted.length >> 1;
    medianStep = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    threshold = gapFactor * medianStep;
    for (let k = 0; k < deltas.length; k++) {
      if (deltas[k] > threshold) {
        gapStarts.push(k + 1);
        ranges.push({ fromStep: step[k], toStep: step[k + 1] });
      }
    }
  }

  return {
    step,
    ...columns,
    gapStarts: Uint32Array.from(gapStarts),
    duplicateIndex: Uint32Array.from(duplicateIndex),
    nonFiniteIndex,
    quality: {
      rawRows: n,
      rows,
      invalidStepRows: n - valid,
      orderBreaks,
      duplicateSteps,
      overwrittenRows,
      overwrittenNonFinite,
      nonFinite,
      gaps: { medianStep, threshold, ranges },
    },
  };
}
