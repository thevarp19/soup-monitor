import type { NormalizedRun } from './normalize.ts';

export interface PointRef {
  step: number;
  value: number;
}

/**
 * Values for the summary cards. Rules:
 *  - statistics (min, max, "current") are taken over FINITE values; NaN/±Inf are counted and shown
 *    separately instead of being folded into a number;
 *  - `lastLoss` is the last logged value even if it is NaN — showing the last finite value as
 *    "last" would hide that the run has just produced NaN;
 *  - ties: the earliest step (same convention as the chart tooltip);
 *  - no data → null (never 0, never ±Infinity from an empty Math.min).
 * Plain loops on purpose: Math.min(...array) throws a RangeError on ~10^5+ elements.
 */
export interface RunSummary {
  points: number;
  firstStep: number | null;
  lastStep: number | null;
  lastLoss: PointRef | null;
  lastFiniteLoss: PointRef | null;
  minLoss: PointRef | null;
  currentLr: PointRef | null;
  maxGradNorm: PointRef | null;
  /** grad_norm values that overflowed to +Infinity (not reflected in maxGradNorm). */
  gradNormPosInf: number;
  /** NaN values across loss, lr and grad_norm. */
  nanCount: number;
  /** ±Infinity values across loss, lr and grad_norm. */
  infCount: number;
  duplicateSteps: number;
  gapCount: number;
}

export function summarize(run: NormalizedRun): RunSummary {
  const n = run.step.length;
  let lastFiniteLoss: PointRef | null = null;
  let minLoss: PointRef | null = null;
  let currentLr: PointRef | null = null;
  let maxGradNorm: PointRef | null = null;
  let gradNormPosInf = 0;

  for (let i = 0; i < n; i++) {
    const step = run.step[i];
    const loss = run.loss[i];
    if (Number.isFinite(loss)) {
      lastFiniteLoss = { step, value: loss };
      if (minLoss === null || loss < minLoss.value) minLoss = { step, value: loss };
    }
    const lr = run.lr[i];
    if (Number.isFinite(lr)) currentLr = { step, value: lr };
    const g = run.grad_norm[i];
    if (Number.isFinite(g)) {
      if (maxGradNorm === null || g > maxGradNorm.value) maxGradNorm = { step, value: g };
    } else if (g === Infinity) gradNormPosInf++;
  }

  const q = run.quality;
  const all = [q.nonFinite.loss, q.nonFinite.lr, q.nonFinite.grad_norm];
  return {
    points: n,
    firstStep: n > 0 ? run.step[0] : null,
    lastStep: n > 0 ? run.step[n - 1] : null,
    lastLoss: n > 0 ? { step: run.step[n - 1], value: run.loss[n - 1] } : null,
    lastFiniteLoss,
    minLoss,
    currentLr,
    maxGradNorm,
    gradNormPosInf,
    nanCount: all.reduce((s, c) => s + c.nan, 0),
    infCount: all.reduce((s, c) => s + c.posInf + c.negInf, 0),
    duplicateSteps: q.duplicateSteps,
    gapCount: q.gaps.ranges.length,
  };
}
