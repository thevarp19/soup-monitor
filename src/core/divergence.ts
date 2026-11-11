/**
 * "Does the smoothing hide something?" Heavy EMA lags: when the loss turns up late in a run, the
 * smoothed line keeps showing the old level (reproduced in divergence.test.ts: raw > 1.5× the EMA
 * 0.999 value at the last step). This compares the smoothed line with the mean of the most recent
 * `window` finite raw values at each point of [from, to] and reports the largest relative gap.
 * The short trailing mean stands for "what the raw data says right now" with the noise averaged out.
 * Computed on the raw series (not the downsampled one), like the EMA itself.
 */
export const SMOOTHING_GAP_WINDOW = 20;
/** Warn when the smoothed line is more than 10% away from the recent raw values. */
export const SMOOTHING_GAP_THRESHOLD = 0.1;

export interface SmoothingGap {
  maxRelGap: number;
  atIndex: number;
  smoothedIs: 'above' | 'below';
}

export function smoothingGap(y: Float64Array, smooth: Float64Array, from: number, to: number, window = SMOOTHING_GAP_WINDOW): SmoothingGap | null {
  const ring = new Float64Array(window);
  let count = 0;
  let sum = 0;
  let pos = 0;
  let best: SmoothingGap | null = null;
  // Start early enough to fill the window before `from` (unless there are many NaN — then fewer).
  const begin = Math.max(0, from - 4 * window);
  for (let i = begin; i <= to && i < y.length; i++) {
    const v = y[i];
    if (Number.isFinite(v)) {
      if (count === window) sum -= ring[pos];
      else count++;
      ring[pos] = v;
      sum += v;
      pos = (pos + 1) % window;
    }
    if (i < from || count < Math.ceil(window / 2)) continue;
    const e = smooth[i];
    if (!Number.isFinite(e)) continue;
    const m = sum / count;
    const gap = Math.abs(m - e) / Math.max(Math.abs(m), Math.abs(e), 1e-12);
    if (best === null || gap > best.maxRelGap) best = { maxRelGap: gap, atIndex: i, smoothedIs: e < m ? 'below' : 'above' };
  }
  return best;
}
