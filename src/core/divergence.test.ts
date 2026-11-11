import { describe, expect, it } from 'vitest';
import { smoothingGap } from './divergence.ts';
import { ema } from './ema.ts';
import { generateRun } from './generate.ts';
import { normalize } from './normalize.ts';
import { RUN_SPECS } from './runSpecs.ts';

const f64 = (a: number[]) => Float64Array.from(a);

describe('the silent failure: heavy smoothing hides a late divergence', () => {
  const spec = RUN_SPECS.find((s) => s.id === 'late-divergence');
  if (!spec) throw new Error('late-divergence missing');
  const run = normalize(generateRun(spec).raw);
  const n = run.loss.length;
  const tailMean = (y: Float64Array, k: number) => {
    let s = 0;
    for (let i = n - k; i < n; i++) s += y[i];
    return s / k;
  };

  it('reproduced: at the last step the raw loss is >50% above where EMA 0.999 says it is', () => {
    const smooth = ema(run.loss, 0.999);
    const rawEnd = tailMean(run.loss, 20);
    expect(rawEnd / smooth[n - 1]).toBeGreaterThan(1.5);
  });

  it('detected: the gap between EMA 0.999 and the recent raw values exceeds 10%, near the end of the run', () => {
    const g = smoothingGap(run.loss, ema(run.loss, 0.999), 0, n - 1);
    expect(g).not.toBeNull();
    expect(g?.maxRelGap).toBeGreaterThan(0.1);
    expect(g?.atIndex).toBeGreaterThan(n * 0.95); // where the loss turns up
    expect(g?.smoothedIs).toBe('below');
  });

  it('light smoothing (EMA 0.6) stays within 10% over the same range', () => {
    const g = smoothingGap(run.loss, ema(run.loss, 0.6), Math.floor(n * 0.9), n - 1);
    expect(g?.maxRelGap).toBeLessThan(0.1);
  });
});

describe('smoothingGap — hand-checked', () => {
  it('a constant series has no gap', () => {
    const y = f64(Array(100).fill(3));
    expect(smoothingGap(y, ema(y, 0.99), 0, 99)?.maxRelGap).toBeCloseTo(0, 12);
  });

  it('a step from 1 to 2: the largest gap is right after the step, with the smoothed line below', () => {
    const y = f64([...Array(200).fill(1), ...Array(200).fill(2)]);
    const g = smoothingGap(y, ema(y, 0.99), 0, 399);
    expect(g?.maxRelGap).toBeGreaterThan(0.3);
    expect(g?.atIndex).toBeGreaterThanOrEqual(200);
    expect(g?.atIndex).toBeLessThan(260);
    expect(g?.smoothedIs).toBe('below');
  });

  it('noise alone does not trigger it: a flat series alternating ±30% stays well under 10%', () => {
    // Comparing the EMA with single raw points would report ~22% here (a false alarm on every noisy
    // metric, e.g. grad_norm); the mean of the last 20 points is exactly 1.
    const y = f64(Array.from({ length: 400 }, (_, i) => (i % 2 ? 1.3 : 0.7)));
    expect(smoothingGap(y, ema(y, 0.9), 50, 399)?.maxRelGap).toBeLessThan(0.05);
  });

  it('only looks inside [from, to]', () => {
    const y = f64([...Array(200).fill(1), ...Array(200).fill(2)]);
    expect(smoothingGap(y, ema(y, 0.99), 0, 150)?.maxRelGap).toBeCloseTo(0, 12);
  });

  it('NaN in the raw series is skipped, not propagated', () => {
    const y = f64([...Array(50).fill(1), NaN, NaN, ...Array(50).fill(1)]);
    const g = smoothingGap(y, ema(y, 0.9), 0, 101);
    expect(Number.isFinite(g?.maxRelGap)).toBe(true);
  });

  it('nothing comparable (all NaN) → null', () => {
    const y = f64([NaN, NaN, NaN]);
    expect(smoothingGap(y, ema(y, 0.9), 0, 2)).toBeNull();
  });
});
