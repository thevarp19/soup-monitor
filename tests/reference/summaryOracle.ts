/**
 * Brute-force reference for the summary cards: plain loops over the oracle-normalized rows.
 * Shares no code with src/core/summary.ts.
 */
import type { OracleResult } from './normalizeOracle.ts';

type Ref = { step: number; value: number } | null;

export function summaryOracle(o: OracleResult) {
  const n = o.step.length;
  let lastLoss: Ref = null;
  let lastFiniteLoss: Ref = null;
  let minLoss: Ref = null;
  let currentLr: Ref = null;
  let maxGradNorm: Ref = null;
  let gradNormPosInf = 0;
  for (let i = 0; i < n; i++) {
    const step = o.step[i];
    lastLoss = { step, value: o.loss[i] };
    if (Number.isFinite(o.loss[i])) {
      lastFiniteLoss = { step, value: o.loss[i] };
      if (minLoss === null || o.loss[i] < minLoss.value) minLoss = { step, value: o.loss[i] };
    }
    if (Number.isFinite(o.lr[i])) currentLr = { step, value: o.lr[i] };
    if (Number.isFinite(o.grad_norm[i])) {
      if (maxGradNorm === null || o.grad_norm[i] > maxGradNorm.value) maxGradNorm = { step, value: o.grad_norm[i] };
    } else if (o.grad_norm[i] === Infinity) gradNormPosInf++;
  }
  const q = o.quality;
  const metrics = [q.nonFinite.loss, q.nonFinite.lr, q.nonFinite.grad_norm];
  return {
    points: n,
    firstStep: n > 0 ? o.step[0] : null,
    lastStep: n > 0 ? o.step[n - 1] : null,
    lastLoss,
    lastFiniteLoss,
    minLoss,
    currentLr,
    maxGradNorm,
    gradNormPosInf,
    nanCount: metrics.reduce((s, m) => s + m.nan, 0),
    infCount: metrics.reduce((s, m) => s + m.posInf + m.negInf, 0),
    duplicateSteps: q.duplicateSteps,
    gapCount: q.gaps.ranges.length,
  };
}
