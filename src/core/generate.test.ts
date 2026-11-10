import { describe, expect, it } from 'vitest';
import { generateRun } from './generate.ts';
import { RUN_SPECS } from './runSpecs.ts';
import type { Columns, GeneratedRun, RunSpec } from './types.ts';
import { METRICS } from './types.ts';

// Small hand-sized spec: 101 points, one every 10 steps → steps 0, 10, …, 1000, t = i / 100.
const base: RunSpec = {
  id: 'test',
  name: 'test',
  description: '',
  seed: 1,
  points: 101,
  stepEvery: 10,
  status: 'finished',
  loss: { kind: 'converge' },
  lr: { kind: 'constant', value: 1e-4 },
  defects: [],
};
const make = (over: Partial<RunSpec>): GeneratedRun => generateRun({ ...base, ...over });

// Output of the deterministic generator, recorded once (Node 24) and checked again in Chrome by e2e.
const GOLDEN = {
  loss: [10.630498000659049, 11.103713777838841, 2.773330613116519],
  lr: [0, 0.0000014999999999999998, 0.000029999999999999997],
  grad_norm: [7.432071556802839, 7.959746759507687, 1.1815218351315706],
};

function expectSameBits(a: Float64Array, b: Float64Array) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) throw new Error(`index ${i}: ${a[i]} !== ${b[i]}`);
  }
}

describe('generateRun — determinism', () => {
  it('returns bit-identical columns for the same spec (including NaN positions)', () => {
    const spec: Partial<RunSpec> = {
      defects: [
        { kind: 'nan', metric: 'loss', at: [5] },
        { kind: 'relog', from: 40, length: 3 },
      ],
    };
    const a = make(spec);
    const b = make(spec);
    for (const key of ['step', ...METRICS] as const) expectSameBits(a.raw[key], b.raw[key]);
  });

  it('changes the values when the seed changes', () => {
    const a = make({ seed: 1 }).raw.loss;
    const b = make({ seed: 2 }).raw.loss;
    let equal = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) equal++;
    expect(equal).toBeLessThan(5);
  });

  it('does not perturb other values when a defect is added (defects use their own randomness)', () => {
    const clean = make({}).raw;
    const withSpike = make({ defects: [{ kind: 'spike', metric: 'loss', at: 50, factor: 20 }] }).raw;
    for (let i = 0; i < clean.loss.length; i++) {
      if (i !== 50) expect(withSpike.loss[i]).toBe(clean.loss[i]);
    }
  });
});

describe('generateRun — clean series', () => {
  const { raw, truth } = make({});

  it('logs steps 0, stepEvery, 2·stepEvery, … in order', () => {
    expect(raw.step.length).toBe(101);
    expect(raw.step[0]).toBe(0);
    expect(raw.step[1]).toBe(10);
    expect(raw.step[100]).toBe(1000);
    for (let i = 1; i < raw.step.length; i++) expect(raw.step[i]).toBeGreaterThan(raw.step[i - 1]);
  });

  it('produces only finite, positive loss and grad_norm', () => {
    for (const key of ['loss', 'grad_norm'] as const) {
      for (const v of raw[key]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('starts near ln(50k) ≈ 10.8 and converges downwards', () => {
    expect(raw.loss[0]).toBeGreaterThan(9.5);
    expect(raw.loss[0]).toBeLessThan(12);
    expect(raw.loss[100]).toBeLessThan(raw.loss[0] / 2);
  });

  it('reports no injected defects', () => {
    expect(truth).toEqual({ nonFinite: [], spike: null, relogged: [], gaps: [], unsorted: false });
  });

  it('handles an empty run and a single-point run', () => {
    expect(make({ points: 0 }).raw.step.length).toBe(0);
    const one = make({ points: 1 }).raw;
    expect(Array.from(one.step)).toEqual([0]);
    expect(Number.isFinite(one.loss[0])).toBe(true);
  });
});

describe('generateRun — bit-exact golden values', () => {
  // The generator uses only IEEE-754 exactly-rounded operations (+ − × ÷ √, integer powers by
  // multiplication). Math.exp/log/cos/pow are "implementation-approximated" in ECMAScript and gave
  // different last bits in Node 24 and Chrome 157 (found by the e2e card test). These literals pin
  // the output so any engine — and any refactor — must reproduce it bit for bit.
  it('healthy-cosine: first values of loss, lr, grad_norm', () => {
    const spec = RUN_SPECS.find((s) => s.id === 'healthy-cosine');
    if (!spec) throw new Error('missing');
    const { raw } = generateRun(spec);
    expect([raw.loss[0], raw.loss[1], raw.loss[4999]]).toEqual(GOLDEN.loss);
    expect([raw.lr[0], raw.lr[1], raw.lr[4999]]).toEqual(GOLDEN.lr);
    expect([raw.grad_norm[0], raw.grad_norm[1], raw.grad_norm[4999]]).toEqual(GOLDEN.grad_norm);
  });
});

describe('generateRun — lr schedules', () => {
  const lrAt = (lr: RunSpec['lr'], index: number) => make({ lr }).raw.lr[index];

  it('warmup-cosine: 0 at step 0, linear to peak, cosine down to minLr at the last step', () => {
    const lr = { kind: 'warmup-cosine', peak: 1e-3, warmupSteps: 200, minLr: 1e-4 } as const;
    expect(lrAt(lr, 0)).toBe(0); // step 0 — a real zero, relevant for log scale
    expect(lrAt(lr, 10)).toBeCloseTo(5e-4, 15); // step 100, half-way through warmup
    expect(lrAt(lr, 20)).toBeCloseTo(1e-3, 15); // step 200, end of warmup
    expect(lrAt(lr, 60)).toBeCloseTo(5.5e-4, 15); // step 600, half-way through the cosine
    expect(lrAt(lr, 100)).toBeCloseTo(1e-4, 15); // step 1000, last step
  });

  it('step-decay: multiplies by gamma at each boundary', () => {
    const lr = { kind: 'step-decay', initial: 1e-3, gamma: 0.5, everySteps: 300 } as const;
    expect(lrAt(lr, 29)).toBeCloseTo(1e-3, 15); // step 290
    expect(lrAt(lr, 30)).toBeCloseTo(5e-4, 15); // step 300
    expect(lrAt(lr, 60)).toBeCloseTo(2.5e-4, 15); // step 600
    expect(lrAt(lr, 100)).toBeCloseTo(1.25e-4, 15); // step 1000
  });

  it('constant', () => {
    const run = make({ lr: { kind: 'constant', value: 3e-4 } });
    for (const v of run.raw.lr) expect(v).toBe(3e-4);
  });
});

describe('generateRun — loss shapes', () => {
  const converge = make({}).raw;

  it('diverge multiplies the clean curve by (1 + rate·(t − from))² after `from`', () => {
    const div = make({ loss: { kind: 'diverge', from: 0.5, rate: 2 } }).raw;
    expect(div.loss[30]).toBe(converge.loss[30]); // t = 0.3, before divergence
    expect(div.loss[100] / converge.loss[100]).toBeCloseTo(4, 12); // t = 1: (1 + 2·0.5)² = 4
  });

  it('plateau stops the downward trend after `from`', () => {
    const plat = make({ loss: { kind: 'plateau', from: 0.3 } }).raw;
    const mean = (c: Columns, a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += c.loss[i];
      return s / (b - a);
    };
    // Converging run still drops >5% between t≈0.4 and t≈0.95; the plateau run does not.
    expect(mean(converge, 90, 100) / mean(converge, 40, 50)).toBeLessThan(0.95);
    expect(mean(plat, 90, 100) / mean(plat, 40, 50)).toBeGreaterThan(0.97);
  });

  it('explode: grad_norm hits +Infinity at infAt, then loss and grad_norm are NaN to the end', () => {
    const { raw, truth } = make({ loss: { kind: 'explode', from: 0.7, infAt: 0.85, nanFrom: 0.9 } });
    expect(raw.grad_norm[84]).toBeLessThan(Infinity);
    expect(raw.grad_norm[85]).toBe(Infinity);
    expect(raw.grad_norm[80] / converge.grad_norm[80]).toBeGreaterThan(10); // exploding before inf
    for (let i = 90; i <= 100; i++) {
      expect(raw.loss[i]).toBeNaN();
      expect(raw.grad_norm[i]).toBeNaN();
    }
    expect(raw.loss[89]).not.toBeNaN();
    expect(truth.nonFinite).toContainEqual({ metric: 'grad_norm', step: 850, kind: '+inf' });
    expect(truth.nonFinite).toContainEqual({ metric: 'loss', step: 900, kind: 'nan' });
    expect(truth.nonFinite).toContainEqual({ metric: 'grad_norm', step: 1000, kind: 'nan' });
    expect(truth.nonFinite).toHaveLength(1 + 11 + 11);
  });

  it('shifted produces negative loss values late in the run', () => {
    // clean curve at t = 1 is 2 + 8.8 / 13 ≈ 2.677; with noise at most ×1.12 that is < 3.0
    const { raw } = make({ loss: { kind: 'shifted', offset: 3 } });
    expect(raw.loss[0]).toBeGreaterThan(0);
    expect(raw.loss[100]).toBeLessThan(0);
  });
});

describe('generateRun — value defects', () => {
  it('nan: puts NaN exactly at the given indices and leaves neighbours finite', () => {
    const { raw, truth } = make({ defects: [{ kind: 'nan', metric: 'loss', at: [3, 50] }] });
    expect(raw.loss[3]).toBeNaN();
    expect(raw.loss[50]).toBeNaN();
    expect(Number.isFinite(raw.loss[2])).toBe(true);
    expect(Number.isFinite(raw.loss[4])).toBe(true);
    expect(truth.nonFinite).toEqual([
      { metric: 'loss', step: 30, kind: 'nan' },
      { metric: 'loss', step: 500, kind: 'nan' },
    ]);
  });

  it('nan-series: a run of consecutive NaN', () => {
    const { raw, truth } = make({ defects: [{ kind: 'nan-series', metric: 'loss', from: 10, length: 5 }] });
    expect(Array.from(raw.loss.slice(10, 15)).every(Number.isNaN)).toBe(true);
    expect(raw.loss[9]).not.toBeNaN();
    expect(raw.loss[15]).not.toBeNaN();
    expect(truth.nonFinite.map((e) => e.step)).toEqual([100, 110, 120, 130, 140]);
  });

  it('inf: ±Infinity at the given indices', () => {
    const { raw, truth } = make({ defects: [{ kind: 'inf', metric: 'grad_norm', at: [7], sign: -1 }] });
    expect(raw.grad_norm[7]).toBe(-Infinity);
    expect(truth.nonFinite).toEqual([{ metric: 'grad_norm', step: 70, kind: '-inf' }]);
  });

  it('spike: a single value multiplied by factor, reported with its exact value', () => {
    const clean = make({}).raw;
    const { raw, truth } = make({ defects: [{ kind: 'spike', metric: 'loss', at: 50, factor: 20 }] });
    expect(raw.loss[50]).toBe(clean.loss[50] * 20);
    expect(truth.spike).toEqual({ metric: 'loss', step: 500, value: clean.loss[50] * 20 });
  });

  it('zeros: exact zeros at the given indices', () => {
    const { raw } = make({ defects: [{ kind: 'zeros', metric: 'loss', at: [1, 2] }] });
    expect(raw.loss[1]).toBe(0);
    expect(raw.loss[2]).toBe(0);
  });
});

describe('generateRun — row defects', () => {
  it('gap: removes the rows and reports the surrounding steps', () => {
    const { raw, truth } = make({ defects: [{ kind: 'gap', from: 20, length: 5 }] });
    expect(raw.step.length).toBe(96);
    expect(Array.from(raw.step.slice(18, 22))).toEqual([180, 190, 250, 260]);
    expect(truth.gaps).toEqual([{ fromStep: 190, toStep: 250 }]);
    expect(truth.unsorted).toBe(false);
  });

  it('relog: writes rows a second time with different values right after the originals', () => {
    const clean = make({}).raw;
    const { raw, truth } = make({ defects: [{ kind: 'relog', from: 30, length: 3 }] });
    expect(raw.step.length).toBe(104);
    expect(Array.from(raw.step.slice(29, 37))).toEqual([290, 300, 310, 320, 300, 310, 320, 330]);
    // first writes are the clean values, second writes differ
    expect(raw.loss[30]).toBe(clean.loss[30]);
    expect(raw.loss[33]).not.toBe(clean.loss[30]);
    expect(raw.lr[33]).toBe(clean.lr[30]); // lr is deterministic — same schedule value
    expect(truth.relogged).toEqual([
      { step: 300, writes: 2 },
      { step: 310, writes: 2 },
      { step: 320, writes: 2 },
    ]);
    expect(truth.unsorted).toBe(true); // 300 comes after 320 in log order
  });

  it('swap-blocks: exchanges adjacent blocks of rows', () => {
    const { raw, truth } = make({ defects: [{ kind: 'swap-blocks', at: [10], size: 5 }] });
    expect(Array.from(raw.step.slice(9, 21))).toEqual([90, 150, 160, 170, 180, 190, 100, 110, 120, 130, 140, 200]);
    expect(truth.unsorted).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The catalogue of 20 runs used by the app.

describe('RUN_SPECS catalogue', () => {
  it('has 20 runs with unique ids and seeds', () => {
    expect(RUN_SPECS).toHaveLength(20);
    expect(new Set(RUN_SPECS.map((s) => s.id)).size).toBe(20);
    expect(new Set(RUN_SPECS.map((s) => s.seed)).size).toBe(20);
  });

  it('contains the brief’s special runs: empty, single point, server error, live', () => {
    const byId = new Map(RUN_SPECS.map((s) => [s.id, s]));
    expect(byId.get('empty')?.points).toBe(0);
    expect(byId.get('single-point')?.points).toBe(1);
    expect(byId.get('server-error')?.serverError).toBe(true);
    expect(byId.get('live')?.live).toBeDefined();
  });

  it('long-1m: exactly 1,000,000 points and one spike at step 500,000 that is the global maximum', () => {
    const spec = RUN_SPECS.find((s) => s.id === 'long-1m');
    if (!spec) throw new Error('long-1m missing from the catalogue');
    const { raw, truth } = generateRun(spec);
    expect(raw.step.length).toBe(1_000_000);

    let maxI = -1;
    let max = -Infinity;
    let second = -Infinity;
    for (let i = 0; i < raw.loss.length; i++) {
      const v = raw.loss[i];
      if (v > max) {
        second = max;
        max = v;
        maxI = i;
      } else if (v > second) second = v;
    }
    expect(raw.step[maxI]).toBe(500_000);
    expect(truth.spike).toEqual({ metric: 'loss', step: 500_000, value: max });
    // Unambiguous: nothing else comes close (the run's start is ~10.8; the spike is far above).
    expect(second).toBeLessThan(max / 2);
  });

  // Self-check of the generator: everything the ground truth claims must be visible in the raw
  // data when scanned naively. This catches specs whose defects overlap and cancel each other.
  describe.each(RUN_SPECS.map((s) => [s.id, s] as const))('%s: ground truth matches raw data', (_id, spec) => {
    const { raw, truth } = generateRun(spec);
    const lastWrite = (step: number) => {
      let idx = -1;
      for (let i = 0; i < raw.step.length; i++) if (raw.step[i] === step) idx = i;
      return idx;
    };

    it('non-finite entries are the last write at their step', () => {
      for (const e of truth.nonFinite) {
        const i = lastWrite(e.step);
        expect(i, `step ${e.step} missing`).toBeGreaterThanOrEqual(0);
        const v = raw[e.metric][i];
        if (e.kind === 'nan') expect(v).toBeNaN();
        else expect(v).toBe(e.kind === '+inf' ? Infinity : -Infinity);
      }
    });

    it('relogged steps appear exactly `writes` times', () => {
      for (const r of truth.relogged) {
        const count = raw.step.filter((s) => s === r.step).length;
        expect(count).toBe(r.writes);
      }
    });

    it('gaps have both endpoints present and nothing in between', () => {
      for (const g of truth.gaps) {
        expect(lastWrite(g.fromStep)).toBeGreaterThanOrEqual(0);
        expect(lastWrite(g.toStep)).toBeGreaterThanOrEqual(0);
        expect(raw.step.some((s) => s > g.fromStep && s < g.toStep)).toBe(false);
      }
    });

    it('`unsorted` is true exactly when the log order has a descent', () => {
      let descent = false;
      for (let i = 1; i < raw.step.length; i++) if (raw.step[i] < raw.step[i - 1]) descent = true;
      expect(truth.unsorted).toBe(descent);
    });
  });
});
