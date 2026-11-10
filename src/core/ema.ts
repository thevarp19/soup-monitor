/**
 * Debiased exponential moving average (the smoothing TensorBoard / W&B apply to scalar charts).
 *
 *   acc_k = w · acc_{k−1} + (1 − w) · y_i,   out_i = acc_k / (1 − w^k)
 *
 * where k counts the finite values seen so far. The debias term stops the curve from being pulled
 * towards 0 at the start.
 *
 * Non-finite inputs (NaN, ±Infinity) produce NaN at the same index — the smoothed line breaks
 * there exactly like the raw line — and are skipped by the accumulator, so they neither leak into
 * later values nor get "filled in". Gaps are handled downstream: the smoothed series is downsampled
 * with the same gapStarts as the raw one.
 *
 * Index-based, like TensorBoard: across a gap the smoothing does not account for the missing steps.
 * Must be computed on the RAW series; smoothing a downsampled series would change with zoom.
 */
export function ema(y: Float64Array, weight: number): Float64Array {
  if (!(weight >= 0 && weight < 1)) throw new RangeError(`EMA weight must be in [0, 1), got ${weight}`);
  const out = new Float64Array(y.length);
  let acc = 0;
  let k = 0;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) {
      out[i] = NaN;
      continue;
    }
    k++;
    acc = weight * acc + (1 - weight) * v;
    out[i] = acc / (1 - Math.pow(weight, k));
  }
  return out;
}
