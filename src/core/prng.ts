/**
 * Deterministic pseudo-random numbers. The same seed always yields the same data, so
 * unit tests, e2e tests and the UI all look at byte-identical runs and can be compared
 * against each other ("ground truth").
 *
 * mulberry32: a tiny 32-bit generator. Not cryptographic and with a short period (2^32),
 * which is more than enough for ~1.2M synthetic points.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Approximately standard normal sample: Irwin–Hall, the sum of 12 uniforms minus 6 (mean 0,
 * variance exactly 1, bounded to [−6, 6]).
 *
 * Not Box–Muller on purpose: Math.log and Math.cos are "implementation-approximated" in ECMAScript,
 * and gave different last bits in Node and Chrome, so the "same seed → same data" promise broke
 * between the tests and the browser. Additions of exactly representable values are deterministic
 * in every engine. The bound also keeps multiplicative noise 1 + σ·z positive.
 */
export function gaussian(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng();
  return s - 6;
}
