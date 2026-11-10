import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { downsample } from './downsample.ts';
import { ema } from './ema.ts';

const f64 = (a: number[]) => Float64Array.from(a);
const arr = (a: Float64Array) => Array.from(a);

describe('ema (debiased exponential moving average, TensorBoard-style)', () => {
  it('weight 0 returns the input unchanged', () => {
    expect(arr(ema(f64([3, 1, 4, 1, 5]), 0))).toEqual([3, 1, 4, 1, 5]);
  });

  it('matches a hand computation: w = 0.5 over [2, 4] → [2, 2.5 / 0.75]', () => {
    // i=0: acc = 0.5·0 + 0.5·2 = 1,   debias 1 − 0.5¹ = 0.5  → 2
    // i=1: acc = 0.5·1 + 0.5·4 = 2.5, debias 1 − 0.5² = 0.75 → 3.333…
    expect(arr(ema(f64([2, 4]), 0.5))).toEqual([2, 2.5 / 0.75]);
  });

  it('a constant series stays constant (no pull towards 0 at the start)', () => {
    for (const v of ema(f64([7, 7, 7, 7, 7, 7]), 0.9)) expect(v).toBeCloseTo(7, 12);
  });

  it('NaN stays NaN in the smoothed series — it is not filled or interpolated', () => {
    const out = ema(f64([1, NaN, 3]), 0.5);
    expect(out[1]).toBeNaN();
  });

  it('NaN does not leak into later values: smoothing skips it as if it were not there', () => {
    const withNaN = ema(f64([1, NaN, NaN, 3, 5]), 0.6);
    const without = ema(f64([1, 3, 5]), 0.6);
    expect([withNaN[0], withNaN[3], withNaN[4]]).toEqual(arr(without));
  });

  it('±Infinity is skipped the same way and does not poison the rest of the series', () => {
    const out = ema(f64([1, Infinity, 2, -Infinity, 3]), 0.9);
    expect(out[1]).toBeNaN();
    expect(out[3]).toBeNaN();
    expect([out[0], out[2], out[4]].every(Number.isFinite)).toBe(true);
  });

  it('property: the output is non-finite exactly where the input is', () => {
    const y = fc.array(fc.oneof(fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity)), { maxLength: 200 });
    fc.assert(
      fc.property(y, fc.double({ min: 0, max: 0.999, noNaN: true }), (values, w) => {
        const out = ema(f64(values), w);
        values.forEach((v, i) => expect(Number.isFinite(out[i])).toBe(Number.isFinite(v)));
      }),
    );
  });

  it('rejects weights outside [0, 1)', () => {
    expect(() => ema(f64([1]), 1)).toThrow(RangeError);
    expect(() => ema(f64([1]), -0.1)).toThrow(RangeError);
  });

  it('the smoothed line still breaks across gaps when downsampled with the same gapStarts', () => {
    const x = f64([0, 10, 20, 30, 60, 70]);
    const smooth = ema(f64([1, 2, 3, 4, 5, 6]), 0.5);
    const out = downsample({ x, y: smooth, gapStarts: Uint32Array.from([4]), x0: 0, x1: 70, width: 100, log: false });
    expect(out.y[4]).toBeNull();
    expect(out.x[4]).toBe(45);
  });
});
