/**
 * Min/max-per-pixel downsampling (M4: Jugel et al., "M4: A Visualization-Oriented Time Series
 * Data Aggregation", VLDB 2014).
 *
 * For every pixel column of the visible range we keep the first, min, max and last raw point (in
 * index order). A line through those points covers exactly the same pixels as a line through all
 * raw points, so nothing visible is discarded — in particular the per-column extremes, which is
 * why a single spike survives every zoom level. LTTB was rejected because it *selects* points by
 * visual importance and gives no such guarantee.
 *
 * Truthfulness rules on top of M4:
 *  - Values that cannot be drawn (NaN, ±Infinity, and ≤ 0 on a log scale) are never emitted as
 *    numbers. They break the line (a `null` placed at their step) and are reported as markers.
 *  - A gap (from normalization) breaks the line too, with a `null` half-way across it.
 *  - The function always reads the RAW normalized arrays for the requested range: zooming in
 *    recomputes from the source, never from an earlier downsampled result.
 *  - One raw point beyond each edge is included so the line reaches the plot edges; it is outside
 *    [interiorFrom, interiorTo) and is never used for statistics or the y-range.
 */

export type BreakKind = 'nan' | '+inf' | '-inf' | 'nonpositive';

export interface Marker {
  /** Step of the first value of this kind in the column. */
  step: number;
  kind: BreakKind;
  /** How many raw values of this kind fall in the column. */
  count: number;
  column: number;
}

/** Per pixel column, struct-of-arrays. min/max are NaN for columns with no drawable value. */
export interface BucketStats {
  count: Float64Array;
  fromStep: Float64Array;
  toStep: Float64Array;
  min: Float64Array;
  minStep: Float64Array;
  max: Float64Array;
  maxStep: Float64Array;
  nan: Float64Array;
  posInf: Float64Array;
  negInf: Float64Array;
  nonPositive: Float64Array;
}

export interface DownsampleInput {
  /** Strictly increasing steps (output of normalize). */
  x: Float64Array;
  y: Float64Array;
  /** Indices i where the line must break between i − 1 and i. */
  gapStarts: Uint32Array;
  /** Visible range, inclusive. */
  x0: number;
  x1: number;
  /** Number of pixel columns — device pixels (CSS width × devicePixelRatio). */
  width: number;
  log: boolean;
}

export interface Downsampled {
  x: Float64Array;
  /** `null` = break in the line. */
  y: Array<number | null>;
  /** Output indices [interiorFrom, interiorTo) lie inside [x0, x1]. */
  interiorFrom: number;
  interiorTo: number;
  markers: Marker[];
  buckets: BucketStats;
  /** Raw points (any value) with x in [x0, x1]. */
  sourceCount: number;
  /** Non-null output points inside [x0, x1]. */
  drawnCount: number;
}

/** Pixel column of x for the visible range [x0, x1] split into `width` equal columns. */
export function columnOf(x: number, x0: number, x1: number, width: number): number {
  const span = x1 - x0;
  const p = span > 0 ? Math.floor(((x - x0) / span) * width) : 0;
  return Math.min(p, width - 1);
}

/** First index with a[i] >= v. */
export function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with a[i] > v. */
export function upperBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function breakKind(v: number, log: boolean): BreakKind | null {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return '+inf';
  if (v === -Infinity) return '-inf';
  if (log && v <= 0) return 'nonpositive';
  return null;
}

const KIND_INDEX: Record<BreakKind, number> = { nan: 0, '+inf': 1, '-inf': 2, nonpositive: 3 };

function emptyBuckets(width: number): BucketStats {
  const nan = () => new Float64Array(width).fill(NaN);
  return {
    count: new Float64Array(width),
    fromStep: nan(),
    toStep: nan(),
    min: nan(),
    minStep: nan(),
    max: nan(),
    maxStep: nan(),
    nan: new Float64Array(width),
    posInf: new Float64Array(width),
    negInf: new Float64Array(width),
    nonPositive: new Float64Array(width),
  };
}

export function downsample(input: DownsampleInput): Downsampled {
  const { x, y, gapStarts, x0, x1, log } = input;
  const width = Math.max(1, Math.floor(input.width));
  const n = x.length;
  const buckets = emptyBuckets(width);
  const markers: Marker[] = [];

  const lo = lowerBound(x, x0);
  const hi = upperBound(x, x1);
  if (n === 0) {
    return { x: new Float64Array(0), y: [], interiorFrom: 0, interiorTo: 0, markers, buckets, sourceCount: 0, drawnCount: 0 };
  }
  const start = lo > 0 ? lo - 1 : 0; // left off-screen neighbour
  const end = hi < n ? hi : n - 1; // right off-screen neighbour (inclusive)

  const outX: number[] = [];
  const outY: Array<number | null> = [];
  let pendingBreakX: number | null = null;

  // Current "piece": consecutive drawable points in one column with no break between them.
  let pCol = 0;
  let pFirst = -1;
  let pLast = -1;
  let pMin = -1;
  let pMax = -1;

  const flush = () => {
    if (pFirst < 0) return;
    if (pendingBreakX !== null) {
      if (outX.length > 0) {
        outX.push(pendingBreakX);
        outY.push(null);
      }
      pendingBreakX = null;
    }
    const idx = [pFirst, pMin, pMax, pLast].sort((a, b) => a - b);
    for (let k = 0; k < idx.length; k++) {
      if (k > 0 && idx[k] === idx[k - 1]) continue;
      outX.push(x[idx[k]]);
      outY.push(y[idx[k]]);
    }
    pFirst = -1;
  };
  const markBreak = (atX: number) => {
    flush();
    if (pendingBreakX === null) pendingBreakX = atX;
  };

  const markerAt = new Map<number, Marker>(); // key: column * 4 + kind index
  let gi = 0;

  for (let i = start; i <= end; i++) {
    while (gi < gapStarts.length && gapStarts[gi] < i) gi++;
    if (i > start && gi < gapStarts.length && gapStarts[gi] === i) markBreak((x[i - 1] + x[i]) / 2);

    const v = y[i];
    const inside = i >= lo && i < hi;
    const col = inside ? columnOf(x[i], x0, x1, width) : i < lo ? -1 : width;

    if (inside) {
      if (buckets.count[col] === 0) buckets.fromStep[col] = x[i];
      buckets.count[col]++;
      buckets.toStep[col] = x[i];
    }

    const kind = breakKind(v, log);
    if (kind) {
      if (inside) {
        const field = kind === 'nan' ? 'nan' : kind === '+inf' ? 'posInf' : kind === '-inf' ? 'negInf' : 'nonPositive';
        buckets[field][col]++;
        const key = col * 4 + KIND_INDEX[kind];
        const m = markerAt.get(key);
        if (m) m.count++;
        else {
          const marker: Marker = { step: x[i], kind, count: 1, column: col };
          markerAt.set(key, marker);
          markers.push(marker);
        }
      }
      markBreak(x[i]);
      continue;
    }

    if (inside) {
      if (!(buckets.min[col] <= v)) {
        buckets.min[col] = v;
        buckets.minStep[col] = x[i];
      }
      if (!(buckets.max[col] >= v)) {
        buckets.max[col] = v;
        buckets.maxStep[col] = x[i];
      }
    }

    if (pFirst >= 0 && pCol !== col) flush();
    if (pFirst < 0) {
      pCol = col;
      pFirst = pLast = pMin = pMax = i;
    } else {
      pLast = i;
      if (v < y[pMin]) pMin = i;
      if (v > y[pMax]) pMax = i;
    }
  }
  flush();

  const outXArr = Float64Array.from(outX);
  const interiorFrom = lowerBound(outXArr, x0);
  const interiorTo = upperBound(outXArr, x1);
  let drawnCount = 0;
  for (let k = interiorFrom; k < interiorTo; k++) if (outY[k] !== null) drawnCount++;

  return { x: outXArr, y: outY, interiorFrom, interiorTo, markers, buckets, sourceCount: hi - lo, drawnCount };
}
