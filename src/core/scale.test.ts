import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { downsample } from './downsample.ts';
import { generateRun } from './generate.ts';
import { normalize } from './normalize.ts';
import { RUN_SPECS } from './runSpecs.ts';
import { formatLogTick, formatStepTick, formatTick, linearTicks, logTicks, visibleExtent, xTicks } from './scale.ts';

const EN = 'en-US';
/** Parse an en-US label back to a number (grouping commas removed; "2.5E-4" is valid JS). */
const parseEn = (label: string) => Number(label.replace(/,/g, ''));

describe('linearTicks — axis range and tick values', () => {
  it('nice ticks that cover the data: [0.3, 9.7] → 0, 2, …, 10', () => {
    const t = linearTicks(0.3, 9.7, 6);
    expect(t.ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect([t.min, t.max]).toEqual([0, 10]);
  });

  it('decimal steps without floating-point noise: [0.31, 0.58] → 0.3 … 0.6', () => {
    expect(linearTicks(0.31, 0.58, 4).ticks).toEqual([0.3, 0.4, 0.5, 0.6]);
  });

  it('a constant series (constant lr) gets a non-degenerate range around the value', () => {
    const t = linearTicks(3e-4, 3e-4, 5);
    expect(t.min).toBeLessThan(3e-4);
    expect(t.max).toBeGreaterThan(3e-4);
  });

  it('regression: a range straddling 0 with a budget of 2 ticks terminates with −s, 0, s', () => {
    // with maxTicks = 2 the search used to run the step up to Infinity and return NaN ticks
    // budget raised to 3 → raw step = 4.94e-16 / 2 = 2.47e-16 → nice step 2.5e-16
    const t = linearTicks(-2.470328229206233e-16, 2.470328229206233e-16, 2);
    expect(t.ticks).toEqual([-2.5e-16, 0, 2.5e-16]);
  });

  it('an all-zero series gets [−1, 1]', () => {
    const t = linearTicks(0, 0, 5);
    expect(t.ticks[0]).toBe(-1);
    expect(t.ticks[t.ticks.length - 1]).toBe(1);
  });

  it('regression: does not hang on subnormal extents (it used to loop forever)', () => {
    // 5e-324 · 0.1 underflows to 0 and log10(0) = −Infinity; found by the property test below.
    const t = linearTicks(5e-324, 5e-324, 5);
    expect(t.min).toBeLessThanOrEqual(5e-324);
    expect(t.max).toBeGreaterThanOrEqual(5e-324);
    expect(linearTicks(0, 5e-324, 5).max).toBeGreaterThanOrEqual(5e-324);
  });

  it('refuses non-finite or inverted extents instead of drawing nonsense', () => {
    expect(() => linearTicks(NaN, 1, 5)).toThrow(RangeError);
    expect(() => linearTicks(0, Infinity, 5)).toThrow(RangeError);
    expect(() => linearTicks(2, 1, 5)).toThrow(RangeError);
  });

  it('property: ticks are increasing, cover [min, max], and their labels parse back to the tick values and are unique', () => {
    // Domain: |values| ≥ 1e-200 or exactly 0. Below that, doubles lose precision (subnormals) and
    // "label parses back to the exact tick" cannot hold; there we only guarantee no hang (test above).
    const normal = (min: number) => fc.double({ min, max: 1e9, noNaN: true }).filter((v) => v === 0 || Math.abs(v) >= 1e-200);
    const extent = fc
      .tuple(normal(-1e9), normal(0))
      .map(([a, span]) => [a, a + span] as const)
      .filter(([a, b]) => Number.isFinite(b) && (b - a === 0 || (b - a) / Math.max(Math.abs(a), Math.abs(b)) > 1e-9));
    fc.assert(
      fc.property(extent, fc.integer({ min: 2, max: 12 }), ([lo, hi], maxTicks) => {
        const t = linearTicks(lo, hi, maxTicks);
        for (let i = 1; i < t.ticks.length; i++) expect(t.ticks[i]).toBeGreaterThan(t.ticks[i - 1]);
        expect(t.ticks[0]).toBeLessThanOrEqual(lo);
        expect(t.ticks[t.ticks.length - 1]).toBeGreaterThanOrEqual(hi);
        expect([t.min, t.max]).toEqual([t.ticks[0], t.ticks[t.ticks.length - 1]]);
        const labels = t.ticks.map((v) => formatTick(v, t.step, EN));
        expect(new Set(labels).size).toBe(labels.length);
        labels.forEach((label, i) => expect(parseEn(label)).toBe(t.ticks[i]));
      }),
      { numRuns: 1000 },
    );
  });
});

describe('formatTick — enough digits to tell ticks apart, no more', () => {
  it.each([
    [0.4, 0.2, '0.4'],
    [10, 2, '10'],
    [0.025, 0.025, '0.025'],
    [12_000, 2_000, '12,000'],
    [2.7e-4, 1e-5, '2.7E-4'],
    [2.75e-4, 2.5e-5, '2.75E-4'],
    [3e9, 1e9, '3E9'],
    [-1.5, 0.5, '-1.5'],
    [0, 0.5, '0'],
  ])('%d with step %d → %s', (v, step, want) => {
    expect(formatTick(v, step, EN)).toBe(want);
  });
});

describe('logTicks', () => {
  it('decades covering the data: [3e-5, 3e-4] → 1e-5, 1e-4, 1e-3', () => {
    const t = logTicks(3e-5, 3e-4);
    expect(t.min).toBe(1e-5);
    expect(t.max).toBe(1e-3);
    expect(t.ticks.filter((v) => [1e-5, 1e-4, 1e-3].includes(v))).toEqual([1e-5, 1e-4, 1e-3]);
  });

  it('refuses a non-positive minimum — the caller must handle values ≤ 0 explicitly', () => {
    expect(() => logTicks(0, 1)).toThrow(RangeError);
    expect(() => logTicks(-1, 1)).toThrow(RangeError);
  });

  it('property: positive, increasing, covering, unique labels that parse back', () => {
    const extent = fc
      .tuple(fc.double({ min: 1e-12, max: 1e12, noNaN: true }), fc.double({ min: 1, max: 1e6, noNaN: true }))
      .map(([a, f]) => [a, a * f] as const)
      .filter(([, b]) => b <= 1e15);
    fc.assert(
      fc.property(extent, ([lo, hi]) => {
        const t = logTicks(lo, hi);
        expect(t.ticks.every((v) => v > 0)).toBe(true);
        for (let i = 1; i < t.ticks.length; i++) expect(t.ticks[i]).toBeGreaterThan(t.ticks[i - 1]);
        expect(t.min).toBeLessThanOrEqual(lo);
        expect(t.max).toBeGreaterThanOrEqual(hi);
        const labels = t.ticks.map((v) => formatLogTick(v, EN));
        expect(new Set(labels).size).toBe(labels.length);
        labels.forEach((label, i) => expect(parseEn(label)).toBe(t.ticks[i]));
      }),
      { numRuns: 500 },
    );
  });
});

describe('xTicks — step axis', () => {
  it('integer ticks inside the visible range', () => {
    expect(xTicks(0, 1_000_000, 6)).toEqual([0, 200_000, 400_000, 600_000, 800_000, 1_000_000]);
    // span 20, at most 5 ticks → raw step 20 / 4 = 5 → nice step 5
    expect(xTicks(499_990, 500_010, 5)).toEqual([499_990, 499_995, 500_000, 500_005, 500_010]);
  });

  it('regression: a narrow window with no multiple of the nice step still gets a tick', () => {
    // step 10 fits the tick budget, but no multiple of 10 lies in [3384311, 3384317]; found by fast-check
    expect(xTicks(3_384_311, 3_384_317, 2)).toEqual([3_384_315]);
  });

  it('never produces fractional steps, even for a tiny window', () => {
    expect(xTicks(10, 12, 10)).toEqual([10, 11, 12]);
  });

  it('labels with grouping, parsing back exactly', () => {
    expect(formatStepTick(500_000, EN)).toBe('500,000');
  });

  it('property: ticks are integers within [x0, x1], increasing, at most maxTicks', () => {
    const range = fc.tuple(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 1, max: 1e7 }));
    fc.assert(
      fc.property(range, fc.integer({ min: 2, max: 12 }), ([x0, span], maxTicks) => {
        const t = xTicks(x0, x0 + span, maxTicks);
        expect(t.length).toBeLessThanOrEqual(maxTicks);
        expect(t.length).toBeGreaterThan(0);
        for (const v of t) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(x0);
          expect(v).toBeLessThanOrEqual(x0 + span);
        }
        for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// End to end on the 1M run: the y axis drawn for a zoom window covers the real min and max of the
// raw data in that window, and its labels are the tick values.

describe('long-1m: y-axis range covers the raw extent of every zoom window', () => {
  const spec = RUN_SPECS.find((s) => s.id === 'long-1m');
  if (!spec) throw new Error('long-1m missing');
  const run = normalize(generateRun(spec).raw);
  const S = 500_000;

  const rawExtent = (x0: number, x1: number) => {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < run.step.length; i++) {
      if (run.step[i] < x0 || run.step[i] > x1 || !Number.isFinite(run.loss[i])) continue;
      if (run.loss[i] < mn) mn = run.loss[i];
      if (run.loss[i] > mx) mx = run.loss[i];
    }
    return { min: mn, max: mx };
  };

  it.each([
    ['full range', 0, 999_999],
    ['1/100 around the spike', S - 5_000, S + 4_999],
    ['1/1000 with the spike in the last column', S - 999, S],
    ['1/1000 next to the spike', S + 1, S + 1_000],
    ['first 2000 steps (warmup)', 0, 1_999],
  ])('%s', (_label, x0, x1) => {
    const out = downsample({ x: run.step, y: run.loss, gapStarts: run.gapStarts, x0, x1, width: 800, log: false });
    const ext = visibleExtent(out);
    expect(ext).toEqual(rawExtent(x0, x1));
    if (!ext) throw new Error('no extent');
    const t = linearTicks(ext.min, ext.max, 6);
    expect(t.min).toBeLessThanOrEqual(ext.min);
    expect(t.max).toBeGreaterThanOrEqual(ext.max);
    t.ticks.forEach((v) => expect(parseEn(formatTick(v, t.step, EN))).toBe(v));
  });

  it('visibleExtent takes min and max from every column, including the first and the last', () => {
    const x = Float64Array.from([0, 1, 2, 3]);
    const at = (y: number[]) =>
      visibleExtent(downsample({ x, y: Float64Array.from(y), gapStarts: new Uint32Array(0), x0: 0, x1: 3, width: 4, log: false }));
    expect(at([5, 6, 7, 10])).toEqual({ min: 5, max: 10 }); // max in the last column
    expect(at([1, 6, 7, 3])).toEqual({ min: 1, max: 7 }); // min in the first column
  });

  it('visibleExtent is null when nothing drawable is visible (the chart must say "no data", not draw an axis)', () => {
    const out = downsample({ x: Float64Array.from([0, 1]), y: Float64Array.from([NaN, NaN]), gapStarts: new Uint32Array(0), x0: 0, x1: 1, width: 10, log: false });
    expect(visibleExtent(out)).toBeNull();
  });
});
