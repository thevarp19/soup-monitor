import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeOracle } from '../../tests/reference/normalizeOracle.ts';
import { downsample, type Downsampled } from './downsample.ts';
import { generateRun } from './generate.ts';
import { normalize } from './normalize.ts';
import { RUN_SPECS } from './runSpecs.ts';
import type { Columns } from './types.ts';

const f64 = (a: number[]) => Float64Array.from(a);

function ds(x: number[], y: number[], opts: { x0?: number; x1?: number; width: number; gapStarts?: number[]; log?: boolean }) {
  return downsample({
    x: f64(x),
    y: f64(y),
    gapStarts: Uint32Array.from(opts.gapStarts ?? []),
    x0: opts.x0 ?? x[0] ?? 0,
    x1: opts.x1 ?? x[x.length - 1] ?? 0,
    width: opts.width,
    log: opts.log ?? false,
  });
}

/** Output points that lie inside the visible range (excludes the off-screen edge neighbours). */
function interior(out: Downsampled) {
  const xs: number[] = [];
  const ys: Array<number | null> = [];
  for (let k = out.interiorFrom; k < out.interiorTo; k++) {
    xs.push(out.x[k]);
    ys.push(out.y[k]);
  }
  return { x: xs, y: ys };
}

function maxDrawn(out: Downsampled): number {
  let m = -Infinity;
  for (const v of interior(out).y) if (v !== null && v > m) m = v;
  return m;
}

// ---------------------------------------------------------------------------------------------
describe('downsample — M4 per pixel column (hand-checked)', () => {
  it('emits every point when there are fewer points than columns', () => {
    const out = ds([0, 1, 2, 3], [1, 2, 3, 4], { width: 10 });
    expect(Array.from(out.x)).toEqual([0, 1, 2, 3]);
    expect(out.y).toEqual([1, 2, 3, 4]);
  });

  it('keeps first, min, max and last of a column, in index order', () => {
    const out = ds([0, 1, 2, 3, 4, 5, 6, 7], [5, 1, 9, 6, 7, 3, 8, 2], { width: 1 });
    expect(Array.from(out.x)).toEqual([0, 1, 2, 7]);
    expect(out.y).toEqual([5, 1, 9, 2]);
  });

  it('does this per column: x 0–3 fall in column 0, x 4–7 in column 1', () => {
    // column = floor((x − 0) / 7 · 2), clamped to 1 at x = 7
    const out = ds([0, 1, 2, 3, 4, 5, 6, 7], [5, 1, 9, 6, 7, 3, 8, 2], { width: 2 });
    expect(Array.from(out.x)).toEqual([0, 1, 2, 3, 4, 6, 7]);
    expect(out.y).toEqual([5, 1, 9, 6, 7, 8, 2]);
  });

  it('reports how many raw points it summarised and how many it drew', () => {
    const out = ds([0, 1, 2, 3, 4, 5, 6, 7], [5, 1, 9, 6, 7, 3, 8, 2], { width: 1 });
    expect(out.sourceCount).toBe(8);
    expect(out.drawnCount).toBe(4);
  });
});

describe('downsample — NaN, ±Infinity and gaps break the line', () => {
  it('puts a break (null) where NaN/Inf are — never 0, never interpolated', () => {
    const out = ds([0, 1, 2, 3, 4], [1, NaN, 3, Infinity, 5], { width: 10 });
    expect(Array.from(out.x)).toEqual([0, 1, 2, 3, 4]);
    expect(out.y).toEqual([1, null, 3, null, 5]);
    expect(out.y).not.toContain(0);
  });

  it('turns every non-finite value into a marker with its kind and count', () => {
    const out = ds([0, 1, 2, 3, 4, 5], [1, NaN, Infinity, -Infinity, 5, 6], { width: 100 });
    expect(out.markers.map(({ step, kind, count }) => ({ step, kind, count }))).toEqual([
      { step: 1, kind: 'nan', count: 1 },
      { step: 2, kind: '+inf', count: 1 },
      { step: 3, kind: '-inf', count: 1 },
    ]);
  });

  it('aggregates markers per column when zoomed out', () => {
    const out = ds([0, 1, 2, 3, 4, 5, 6, 7], [1, NaN, NaN, 4, NaN, 6, 7, 8], { width: 1 });
    expect(out.markers.map(({ step, kind, count }) => ({ step, kind, count }))).toEqual([
      { step: 1, kind: 'nan', count: 3 },
    ]);
  });

  it('a run of NaN gives a single break, placed at the first NaN step', () => {
    const out = ds([0, 1, 2, 3, 4], [1, NaN, NaN, NaN, 5], { width: 10 });
    expect(Array.from(out.x)).toEqual([0, 1, 4]);
    expect(out.y).toEqual([1, null, 5]);
  });

  it('breaks the line across a gap (null half-way between the two logged steps)', () => {
    const out = ds([0, 10, 20, 30, 60, 70], [1, 2, 3, 4, 5, 6], { width: 100, gapStarts: [4] });
    expect(Array.from(out.x)).toEqual([0, 10, 20, 30, 45, 60, 70]);
    expect(out.y).toEqual([1, 2, 3, 4, null, 5, 6]);
  });

  it('breaks the line even when the NaN and its neighbours share one pixel column', () => {
    const out = ds([0, 1, 2], [1, NaN, 3], { width: 1 });
    expect(out.y).toEqual([1, null, 3]);
  });
});

describe('downsample — log scale: values ≤ 0 cannot be drawn and are not hidden silently', () => {
  it('reproduction: a naive log transform turns 0 into −∞ and a negative into NaN — no error, just a lie', () => {
    // A chart library fed these either draws a line to the bottom edge (−∞) or silently skips the point.
    expect([Math.log10(1), Math.log10(0), Math.log10(-2)]).toEqual([0, -Infinity, NaN]);
  });

  it('breaks the line at 0 and negatives and reports them as "nonpositive" markers', () => {
    const out = ds([0, 1, 2, 3], [1, 0, -2, 4], { width: 10, log: true });
    expect(Array.from(out.x)).toEqual([0, 1, 3]);
    expect(out.y).toEqual([1, null, 4]);
    expect(out.markers.map(({ step, kind, count }) => ({ step, kind, count }))).toEqual([
      { step: 1, kind: 'nonpositive', count: 1 },
      { step: 2, kind: 'nonpositive', count: 1 },
    ]);
  });

  it('draws the same values normally on a linear scale', () => {
    const out = ds([0, 1, 2, 3], [1, 0, -2, 4], { width: 10, log: false });
    expect(out.y).toEqual([1, 0, -2, 4]);
    expect(out.markers).toEqual([]);
  });
});

describe('downsample — visible range', () => {
  it('summarises only [x0, x1] and adds one off-screen neighbour per side so the line reaches the edges', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = ds(x, x, { x0: 3, x1: 6, width: 10 });
    expect(Array.from(out.x)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(interior(out).x).toEqual([3, 4, 5, 6]);
    expect(out.sourceCount).toBe(4);
  });

  it('a window between two points draws the segment that crosses it, and summarises 0 points', () => {
    const out = ds([0, 100], [1, 2], { x0: 10, x1: 20, width: 10 });
    expect(Array.from(out.x)).toEqual([0, 100]);
    expect(out.sourceCount).toBe(0);
    expect(interior(out).x).toEqual([]);
  });

  it('handles an empty series and a single point', () => {
    expect(ds([], [], { x0: 0, x1: 1, width: 10 }).x.length).toBe(0);
    const one = ds([5], [2.5], { width: 10 });
    expect(Array.from(one.x)).toEqual([5]);
    expect(one.y).toEqual([2.5]);
  });

  it('on ties, reports the earliest step for min and max (same convention as the summary cards)', () => {
    const out = ds([0, 1, 2, 3, 4], [3, 1, 1, 4, 4], { width: 1 });
    expect([out.buckets.min[0], out.buckets.minStep[0], out.buckets.max[0], out.buckets.maxStep[0]]).toEqual([1, 1, 4, 3]);
  });

  it('exposes per-column statistics with the raw values and their steps (for the tooltip)', () => {
    const out = ds([0, 1, 2, 3, 4, 5, 6, 7], [5, 1, 9, 6, 7, NaN, 8, 2], { width: 2 });
    const b = out.buckets;
    expect([b.count[0], b.fromStep[0], b.toStep[0], b.min[0], b.minStep[0], b.max[0], b.maxStep[0]]).toEqual([4, 0, 3, 1, 1, 9, 2]);
    expect([b.count[1], b.min[1], b.minStep[1], b.max[1], b.maxStep[1], b.nan[1]]).toEqual([4, 2, 7, 8, 6, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
// The brief's central claim: the single spike in the 1M run is visible at every zoom level.

describe('long-1m: the spike survives every zoom level and width', () => {
  const spec = RUN_SPECS.find((s) => s.id === 'long-1m');
  if (!spec) throw new Error('long-1m missing');
  const { raw, truth } = generateRun(spec);
  const run = normalize(raw);
  const spike = truth.spike;
  if (!spike) throw new Error('long-1m has no spike');
  const S = spike.step; // 500,000

  const view = (x0: number, x1: number, width: number) =>
    downsample({ x: run.step, y: run.loss, gapStarts: run.gapStarts, x0, x1, width, log: false });

  /** brute-force max of the raw loss in [x0, x1] */
  const rawMax = (x0: number, x1: number) => {
    let m = -Infinity;
    for (let i = 0; i < run.step.length; i++) if (run.step[i] >= x0 && run.step[i] <= x1 && run.loss[i] > m) m = run.loss[i];
    return m;
  };

  const windows: Array<[string, number, number]> = [
    ['full range', 0, 999_999],
    ['1/10, centred', S - 50_000, S + 49_999],
    ['1/100, centred', S - 5_000, S + 4_999],
    ['1/1000, centred', S - 500, S + 499],
    ['±10 steps around the spike', S - 10, S + 10],
    ['1/10, spike on the left edge', S, S + 99_999],
    ['1/10, spike on the right edge', S - 99_999, S],
    ['1/1000, spike on the left edge', S, S + 999],
    ['1/1000, spike on the right edge', S - 999, S],
  ];

  describe.each([320, 800, 1920])('width %i px', (width) => {
    it.each(windows)('%s: max of the drawn data equals the spike value', (_label, x0, x1) => {
      const out = view(x0, x1, width);
      expect(maxDrawn(out)).toBe(spike.value);
      // and it is drawn at the right step
      const k = out.y.indexOf(spike.value);
      expect(out.x[k]).toBe(S);
    });

    it.each([
      ['left half (spike excluded)', 0, S - 1],
      ['right half (spike excluded)', S + 1, 999_999],
      ['an unrelated 1/10 window', 100_000, 199_999],
      ['1/1000 window right next to the spike', S + 1, S + 1000],
    ])('%s: the spike is NOT in the visible data, and max equals the raw max there', (_label, x0, x1) => {
      const out = view(x0, x1, width);
      expect(interior(out).y).not.toContain(spike.value);
      expect(maxDrawn(out)).toBe(rawMax(x0, x1));
    });
  });

  it('full range at 1920 px: draws a few thousand points out of 1,000,000', () => {
    const out = view(0, 999_999, 1920);
    expect(out.sourceCount).toBe(1_000_000);
    expect(out.drawnCount).toBeLessThanOrEqual(4 * 1920);
    expect(out.drawnCount).toBeGreaterThan(1920);
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based: arbitrary series, ranges, widths, linear and log.

interface Case {
  x: number[];
  y: number[];
  x0: number;
  x1: number;
  width: number;
  log: boolean;
}

const yValue = fc.oneof(
  { weight: 8, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, 0) },
);
const caseArb: fc.Arbitrary<Case> = fc
  .array(fc.tuple(fc.integer({ min: 1, max: 6 }), yValue), { maxLength: 300 })
  .chain((pts) => {
    let s = 0;
    const x = pts.map(([d]) => (s += d));
    const y = pts.map(([, v]) => v);
    const lo = (x[0] ?? 0) - 5;
    const hi = (x[x.length - 1] ?? 0) + 5;
    return fc.record({
      x: fc.constant(x),
      y: fc.constant(y),
      x0: fc.integer({ min: lo, max: hi }),
      span: fc.integer({ min: 0, max: hi - lo }),
      width: fc.integer({ min: 1, max: 60 }),
      log: fc.boolean(),
    });
  })
  .map(({ x, y, x0, span, width, log }) => ({ x, y, x0, x1: x0 + span, width, log }));

/** Run the real pipeline: normalize (for gapStarts) → downsample. */
function runCase(c: Case) {
  const n = normalize({ step: f64(c.x), loss: f64(c.y), lr: new Float64Array(c.x.length), grad_norm: new Float64Array(c.x.length) });
  const out = downsample({ x: n.step, y: n.loss, gapStarts: n.gapStarts, x0: c.x0, x1: c.x1, width: c.width, log: c.log });
  return { n, out };
}

// Independent definitions used by the oracle below.
const drawable = (v: number, log: boolean) => Number.isFinite(v) && (!log || v > 0);
const columnOf = (x: number, c: Case) => {
  const span = c.x1 - c.x0;
  const p = span > 0 ? Math.floor(((x - c.x0) / span) * c.width) : 0;
  return Math.min(p, c.width - 1);
};

describe('downsample — properties', () => {
  it('per column, min and max of the drawn points equal min and max of the raw drawable values', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { out } = runCase(c);
        const want = new Map<number, [number, number]>();
        c.x.forEach((x, i) => {
          if (x < c.x0 || x > c.x1 || !drawable(c.y[i], c.log)) return;
          const p = columnOf(x, c);
          const [mn, mx] = want.get(p) ?? [Infinity, -Infinity];
          want.set(p, [Math.min(mn, c.y[i]), Math.max(mx, c.y[i])]);
        });
        const got = new Map<number, [number, number]>();
        const it = interior(out);
        it.x.forEach((x, k) => {
          const v = it.y[k];
          if (v === null) return;
          const p = columnOf(x, c);
          const [mn, mx] = got.get(p) ?? [Infinity, -Infinity];
          got.set(p, [Math.min(mn, v), Math.max(mx, v)]);
        });
        expect(got).toEqual(want);
      }),
      { numRuns: 1000 },
    );
  });

  it('every drawn point is a real raw point (no invented values, NaN never becomes a number)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { out } = runCase(c);
        const byStep = new Map(c.x.map((x, i) => [x, c.y[i]]));
        out.y.forEach((v, k) => {
          if (v === null) return;
          expect(byStep.has(out.x[k])).toBe(true);
          expect(Object.is(byStep.get(out.x[k]), v)).toBe(true);
          expect(drawable(v, c.log)).toBe(true);
        });
      }),
      { numRuns: 1000 },
    );
  });

  it('output x is strictly increasing', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { out } = runCase(c);
        for (let k = 1; k < out.x.length; k++) expect(out.x[k]).toBeGreaterThan(out.x[k - 1]);
      }),
      { numRuns: 1000 },
    );
  });

  it('no line segment crosses a NaN/Inf, a value ≤ 0 on log scale, or a gap', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { n, out } = runCase(c);
        const indexOf = new Map(Array.from(n.step, (x, i) => [x, i]));
        const gapStart = new Set(n.gapStarts);
        for (let k = 1; k < out.x.length; k++) {
          if (out.y[k] === null || out.y[k - 1] === null) continue;
          const a = indexOf.get(out.x[k - 1]);
          const b = indexOf.get(out.x[k]);
          if (a === undefined || b === undefined) throw new Error('drawn point is not a raw point');
          for (let i = a + 1; i <= b; i++) {
            expect(gapStart.has(i), `gap before index ${i} is bridged`).toBe(false);
            if (i < b) expect(drawable(n.loss[i], c.log), `non-drawable index ${i} is bridged`).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('markers account for every non-drawable value in the visible range, by kind', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { out } = runCase(c);
        const want: Record<string, number> = {};
        c.x.forEach((x, i) => {
          if (x < c.x0 || x > c.x1) return;
          const v = c.y[i];
          const kind = Number.isNaN(v) ? 'nan' : v === Infinity ? '+inf' : v === -Infinity ? '-inf' : c.log && v <= 0 ? 'nonpositive' : null;
          if (kind) want[kind] = (want[kind] ?? 0) + 1;
        });
        const got: Record<string, number> = {};
        for (const m of out.markers) got[m.kind] = (got[m.kind] ?? 0) + m.count;
        expect(got).toEqual(want);
      }),
      { numRuns: 1000 },
    );
  });

  it('draws at most 4 points per column (+2 edge neighbours) when there are no breaks', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const clean: Case = { ...c, y: c.y.map((v) => (Number.isFinite(v) ? Math.abs(v) + 1 : 1)) };
        const { n, out } = runCase(clean);
        if (n.gapStarts.length > 0) return;
        expect(out.x.length).toBeLessThanOrEqual(4 * c.width + 2);
      }),
      { numRuns: 500 },
    );
  });

  it('per-column tooltip statistics match brute force', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { out } = runCase(c);
        for (let p = 0; p < c.width; p++) {
          const idx = c.x.map((_, i) => i).filter((i) => c.x[i] >= c.x0 && c.x[i] <= c.x1 && columnOf(c.x[i], c) === p);
          expect(out.buckets.count[p]).toBe(idx.length);
          const d = idx.filter((i) => drawable(c.y[i], c.log));
          if (d.length === 0) {
            expect(out.buckets.min[p]).toBeNaN();
            continue;
          }
          const minI = d.reduce((a, i) => (c.y[i] < c.y[a] ? i : a));
          const maxI = d.reduce((a, i) => (c.y[i] > c.y[a] ? i : a));
          expect([out.buckets.min[p], out.buckets.minStep[p]]).toEqual([c.y[minI], c.x[minI]]);
          expect([out.buckets.max[p], out.buckets.maxStep[p]]).toEqual([c.y[maxI], c.x[maxI]]);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// End to end through normalization: duplicates and unsorted steps do not distort the line.

describe('duplicates and unsorted steps do not distort the drawn line', () => {
  /** One column per logged step: the drawn line must be exactly the true (last-write) series. */
  function drawnAtFullResolution(raw: Columns) {
    const n = normalize(raw);
    const x0 = n.step[0];
    const x1 = n.step[n.step.length - 1];
    const width = (x1 - x0) / 10 + 1; // catalogue runs log every 10 steps
    const out = downsample({ x: n.step, y: n.loss, gapStarts: n.gapStarts, x0, x1, width, log: false });
    const xs: number[] = [];
    const ys: number[] = [];
    out.y.forEach((v, k) => {
      if (v !== null) {
        xs.push(out.x[k]);
        ys.push(v);
      }
    });
    return { xs, ys };
  }

  it.each(['duplicate-steps', 'unsorted-steps', 'kitchen-sink'])('%s: drawn points = oracle-normalized finite points', (id) => {
    const spec = RUN_SPECS.find((s) => s.id === id);
    if (!spec) throw new Error(id);
    const { raw } = generateRun(spec);
    const oracle = normalizeOracle(raw);
    const want = oracle.step.map((x, i) => [x, oracle.loss[i]] as const).filter(([, v]) => Number.isFinite(v));
    const { xs, ys } = drawnAtFullResolution(raw);
    expect(xs).toEqual(want.map(([x]) => x));
    expect(ys).toEqual(want.map(([, v]) => v));
  });

  it('shuffling rows with unique steps does not change what is drawn', () => {
    const arb = fc
      .uniqueArray(fc.integer({ min: 0, max: 5000 }), { minLength: 2, maxLength: 200 })
      .chain((steps) => fc.tuple(fc.constant(steps), fc.shuffledSubarray(steps, { minLength: steps.length }), fc.integer({ min: 1, max: 80 })));
    fc.assert(
      fc.property(arb, ([steps, shuffled, width]) => {
        const make = (s: number[]): Columns => ({ step: f64(s), loss: f64(s.map((v) => Math.sin(v) * 10)), lr: f64(s.map(() => 0)), grad_norm: f64(s.map(() => 0)) });
        const draw = (s: number[]) => {
          const n = normalize(make(s));
          const out = downsample({ x: n.step, y: n.loss, gapStarts: n.gapStarts, x0: n.step[0], x1: n.step[n.step.length - 1], width, log: false });
          return { x: Array.from(out.x), y: out.y };
        };
        expect(draw(shuffled)).toEqual(draw(steps));
      }),
      { numRuns: 300 },
    );
  });
});
