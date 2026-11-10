import { describe, expect, it } from 'vitest';
import { gaussian, mulberry32 } from './prng.ts';

describe('mulberry32', () => {
  it('produces the identical sequence for the same seed (generator is reproducible)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 100 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBeLessThan(5);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = mulberry32(7);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('gaussian (Irwin–Hall: sum of 12 uniforms − 6)', () => {
  it('stays within [−6, 6] — so multiplicative noise 1 + σ·z can never flip the sign', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100_000; i++) {
      const z = gaussian(rng);
      expect(z).toBeGreaterThanOrEqual(-6);
      expect(z).toBeLessThanOrEqual(6);
    }
  });

  it('has mean ≈ 0 and standard deviation ≈ 1, and never returns a non-finite value', () => {
    const rng = mulberry32(99);
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = gaussian(rng);
      expect(Number.isFinite(z)).toBe(true);
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(1, 1);
  });
});
