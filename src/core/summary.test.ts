import { describe, expect, it } from 'vitest';
import { normalizeOracle } from '../../tests/reference/normalizeOracle.ts';
import { summaryOracle } from '../../tests/reference/summaryOracle.ts';
import { generateRun } from './generate.ts';
import { normalize } from './normalize.ts';
import { RUN_SPECS } from './runSpecs.ts';
import { summarize } from './summary.ts';
import type { Columns } from './types.ts';

type Row = [step: number, loss: number, lr: number, grad_norm: number];
const cols = (rows: Row[]): Columns => ({
  step: Float64Array.from(rows, (r) => r[0]),
  loss: Float64Array.from(rows, (r) => r[1]),
  lr: Float64Array.from(rows, (r) => r[2]),
  grad_norm: Float64Array.from(rows, (r) => r[3]),
});

describe('summarize — hand-checked', () => {
  const s = summarize(
    normalize(
      cols([
        [0, 3, 0.1, 5],
        [10, 1, 0.2, Infinity],
        [20, 1, 0.3, 7],
        [30, NaN, NaN, 2],
      ]),
    ),
  );

  it('reports the last logged loss even when it is NaN, and the last finite one separately', () => {
    expect(s.lastLoss).toEqual({ step: 30, value: NaN });
    expect(s.lastFiniteLoss).toEqual({ step: 20, value: 1 });
  });

  it('min loss over finite values, earliest step on ties', () => {
    expect(s.minLoss).toEqual({ step: 10, value: 1 });
  });

  it('current lr = last finite lr', () => {
    expect(s.currentLr).toEqual({ step: 20, value: 0.3 });
  });

  it('max grad_norm over finite values, with +Infinity counted separately (not hidden)', () => {
    expect(s.maxGradNorm).toEqual({ step: 20, value: 7 });
    expect(s.gradNormPosInf).toBe(1);
  });

  it('counts non-finite values over all metrics', () => {
    expect(s.nanCount).toBe(2); // loss and lr at step 30
    expect(s.infCount).toBe(1);
  });

  it('an empty run has no values, not zeros', () => {
    const e = summarize(normalize(cols([])));
    expect(e.lastLoss).toBeNull();
    expect(e.minLoss).toBeNull();
    expect(e.currentLr).toBeNull();
    expect(e.maxGradNorm).toBeNull();
    expect(e.points).toBe(0);
  });
});

describe('summarize — catalogue runs equal brute force over the raw data', () => {
  it.each(RUN_SPECS.map((s) => [s.id, s] as const))('%s', (_id, spec) => {
    const { raw } = generateRun(spec);
    expect(summarize(normalize(raw))).toEqual(summaryOracle(normalizeOracle(raw)));
  });

  it('nan-single: last logged loss is NaN on the very last step — the card must not show a stale finite value as "last"', () => {
    const spec = RUN_SPECS.find((s) => s.id === 'nan-single');
    if (!spec) throw new Error('nan-single missing');
    const s = summarize(normalize(generateRun(spec).raw));
    expect(s.lastLoss?.step).toBe(39_990);
    expect(s.lastLoss?.value).toBeNaN();
    expect(s.lastFiniteLoss?.step).toBe(39_980);
  });
});
