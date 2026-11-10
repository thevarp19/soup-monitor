/**
 * What the chart readout shows under the cursor. Built from the per-pixel-column statistics of the
 * downsampled view, which carry RAW values and their steps — so hovering a zoomed-out spike shows
 * the spike's exact value, not some nearby point that happens to be closest to the cursor.
 */
import { columnOf, type BucketStats } from '../core/downsample.ts';

export type Readout =
  | { kind: 'point'; step: number; value: number | null; nonPositive?: true; nearest?: true }
  | {
      kind: 'range';
      fromStep: number;
      toStep: number;
      count: number;
      min: number;
      minStep: number;
      max: number;
      maxStep: number;
      nan: number;
      posInf: number;
      negInf: number;
      nonPositive: number;
      nearest?: true;
    };

function bucket(b: BucketStats, p: number): Readout {
  if (b.count[p] === 1) {
    const step = b.fromStep[p];
    if (b.nan[p]) return { kind: 'point', step, value: NaN };
    if (b.posInf[p]) return { kind: 'point', step, value: Infinity };
    if (b.negInf[p]) return { kind: 'point', step, value: -Infinity };
    if (b.nonPositive[p]) return { kind: 'point', step, value: null, nonPositive: true }; // ≤ 0 on a log scale
    return { kind: 'point', step, value: b.min[p] };
  }
  return {
    kind: 'range',
    fromStep: b.fromStep[p],
    toStep: b.toStep[p],
    count: b.count[p],
    min: b.min[p],
    minStep: b.minStep[p],
    max: b.max[p],
    maxStep: b.maxStep[p],
    nan: b.nan[p],
    posInf: b.posInf[p],
    negInf: b.negInf[p],
    nonPositive: b.nonPositive[p],
  };
}

/**
 * Readout for the steps [a, b] — the CSS pixel under the cursor, which on HiDPI spans several
 * device-pixel columns. All those columns are merged, so the extreme drawn under the pointer is
 * always reported (reading only the column under the pointer's centre missed the spike by half a
 * CSS pixel in an e2e test). Empty → the nearest non-empty column.
 */
export function readoutBetween(view: { buckets: BucketStats }, x0: number, x1: number, a: number, b: number): Readout | null {
  const B = view.buckets;
  const width = B.count.length;
  const clamp = (x: number) => Math.min(Math.max(x, x0), x1);
  const p0 = columnOf(clamp(Math.min(a, b)), x0, x1, width);
  const p1 = columnOf(clamp(Math.max(a, b)), x0, x1, width);

  const nonEmpty: number[] = [];
  for (let p = p0; p <= p1; p++) if (B.count[p] > 0) nonEmpty.push(p);
  if (nonEmpty.length === 1) return bucket(B, nonEmpty[0]);
  if (nonEmpty.length > 1) {
    const r = { kind: 'range' as const, fromStep: B.fromStep[nonEmpty[0]], toStep: B.toStep[nonEmpty[nonEmpty.length - 1]], count: 0, min: NaN, minStep: NaN, max: NaN, maxStep: NaN, nan: 0, posInf: 0, negInf: 0, nonPositive: 0 };
    for (const p of nonEmpty) {
      r.count += B.count[p];
      r.nan += B.nan[p];
      r.posInf += B.posInf[p];
      r.negInf += B.negInf[p];
      r.nonPositive += B.nonPositive[p];
      if (Number.isNaN(B.min[p])) continue; // a column with no drawable value (only NaN/±∞/≤0)
      if (!(r.min <= B.min[p])) [r.min, r.minStep] = [B.min[p], B.minStep[p]];
      if (!(r.max >= B.max[p])) [r.max, r.maxStep] = [B.max[p], B.maxStep[p]];
    }
    return r;
  }
  const c = Math.round((p0 + p1) / 2);
  for (let d = 1; d < width; d++) {
    const left = c - d;
    const right = c + d;
    const hit = left >= 0 && B.count[left] > 0 ? left : right < width && B.count[right] > 0 ? right : -1;
    if (hit >= 0) return { ...bucket(B, hit), nearest: true };
    if (left < 0 && right >= width) break;
  }
  return null;
}

/** Readout at a single step `x` for a view computed over [x0, x1]. */
export function readoutAt(view: { buckets: BucketStats }, x0: number, x1: number, x: number): Readout | null {
  return readoutBetween(view, x0, x1, x, x);
}
