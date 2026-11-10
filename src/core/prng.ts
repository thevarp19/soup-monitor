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

/** Standard normal sample via Box–Muller. `1 - rng()` keeps the log argument in (0, 1]. */
export function gaussian(rng: Rng): number {
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
