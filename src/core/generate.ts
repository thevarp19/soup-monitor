import { gaussian, mulberry32 } from './prng.ts';
import type { Columns, Defect, GeneratedRun, GroundTruth, LossShape, LrSchedule, Metric, RunSpec } from './types.ts';

// Clean loss curve: starts at ~ln(50k vocab) and decays like a power law towards LOSS_FLOOR.
const LOSS_START = 10.8;
const LOSS_FLOOR = 2.0;
const LOSS_NOISE = 0.02; // multiplicative log-normal noise, σ of log(loss)
const GRAD_START = 8.0;
const GRAD_FLOOR = 0.6;
const GRAD_NOISE = 0.15;
const GRAD_EXPLODE_RATE = 40;
const LOSS_EXPLODE_RATE = 2;

function cleanLossCurve(t: number): number {
  return LOSS_FLOOR + (LOSS_START - LOSS_FLOOR) / Math.pow(1 + 25 * t, 0.8);
}

function lossAt(shape: LossShape, t: number, noise: number): number {
  switch (shape.kind) {
    case 'converge':
      return cleanLossCurve(t) * noise;
    case 'diverge':
      return cleanLossCurve(t) * noise * Math.exp(shape.rate * Math.max(0, t - shape.from));
    case 'plateau':
      return cleanLossCurve(Math.min(t, shape.from)) * noise;
    case 'explode':
      return cleanLossCurve(t) * noise * Math.exp(LOSS_EXPLODE_RATE * Math.max(0, t - shape.from));
    case 'shifted':
      return cleanLossCurve(t) * noise - shape.offset;
  }
}

function gradNormAt(shape: LossShape, t: number, noise: number): number {
  const g = (GRAD_FLOOR + (GRAD_START - GRAD_FLOOR) * Math.exp(-5 * t)) * noise;
  return shape.kind === 'explode' ? g * Math.exp(GRAD_EXPLODE_RATE * Math.max(0, t - shape.from)) : g;
}

function lrAt(schedule: LrSchedule, step: number, lastStep: number): number {
  switch (schedule.kind) {
    case 'constant':
      return schedule.value;
    case 'step-decay':
      return schedule.initial * Math.pow(schedule.gamma, Math.floor(step / schedule.everySteps));
    case 'warmup-cosine': {
      const { peak, warmupSteps, minLr } = schedule;
      if (step < warmupSteps) return (peak * step) / warmupSteps;
      const span = lastStep - warmupSteps;
      const progress = span > 0 ? (step - warmupSteps) / span : 1;
      return minLr + 0.5 * (peak - minLr) * (1 + Math.cos(Math.PI * progress));
    }
  }
}

const indexOf = (fraction: number, points: number) => Math.round(fraction * (points - 1));

/**
 * Deterministically generate one run, then inject its defects.
 *
 * Randomness is drawn in a fixed order (all loss noise, then all grad noise) from the spec's
 * seed, independent of shape and defects, so adding a defect never changes any other value.
 * Re-logged rows use a second, derived stream for the same reason.
 */
export function generateRun(spec: RunSpec): GeneratedRun {
  const n = spec.points;
  const rng = mulberry32(spec.seed);
  const relogRng = mulberry32(spec.seed ^ 0x9e3779b9);

  const lossNoise = new Float64Array(n);
  const gradNoise = new Float64Array(n);
  for (let i = 0; i < n; i++) lossNoise[i] = Math.exp(LOSS_NOISE * gaussian(rng));
  for (let i = 0; i < n; i++) gradNoise[i] = Math.exp(GRAD_NOISE * gaussian(rng));

  const lastStep = Math.max(0, n - 1) * spec.stepEvery;
  const clean: Columns = {
    step: new Float64Array(n),
    loss: new Float64Array(n),
    lr: new Float64Array(n),
    grad_norm: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const step = i * spec.stepEvery;
    clean.step[i] = step;
    clean.loss[i] = lossAt(spec.loss, t, lossNoise[i]);
    clean.lr[i] = lrAt(spec.lr, step, lastStep);
    clean.grad_norm[i] = gradNormAt(spec.loss, t, gradNoise[i]);
  }

  const truth: GroundTruth = { nonFinite: [], spike: null, relogged: [], gaps: [], unsorted: false };

  // --- value defects (modify the clean columns in place) -------------------------------------
  const setValue = (metric: Metric, i: number, value: number) => {
    clean[metric][i] = value;
    const kind = Number.isNaN(value) ? 'nan' : value === Infinity ? '+inf' : value === -Infinity ? '-inf' : null;
    if (kind) truth.nonFinite.push({ metric, step: clean.step[i], kind });
  };

  if (spec.loss.kind === 'explode' && n > 0) {
    setValue('grad_norm', indexOf(spec.loss.infAt, n), Infinity);
    for (let i = indexOf(spec.loss.nanFrom, n); i < n; i++) {
      setValue('loss', i, NaN);
      setValue('grad_norm', i, NaN);
    }
  }

  const rowDefects: Defect[] = [];
  for (const d of spec.defects) {
    switch (d.kind) {
      case 'nan':
        for (const i of d.at) setValue(d.metric, i, NaN);
        break;
      case 'nan-series':
        for (let i = d.from; i < d.from + d.length; i++) setValue(d.metric, i, NaN);
        break;
      case 'inf':
        for (const i of d.at) setValue(d.metric, i, d.sign * Infinity);
        break;
      case 'spike': {
        const value = clean[d.metric][d.at] * d.factor;
        setValue(d.metric, d.at, value);
        truth.spike = { metric: d.metric, step: clean.step[d.at], value };
        break;
      }
      case 'zeros':
        for (const i of d.at) setValue(d.metric, i, 0);
        break;
      default:
        rowDefects.push(d);
    }
  }

  if (rowDefects.length === 0) return { spec, raw: clean, truth };

  // --- row defects (remove / duplicate / reorder rows) ----------------------------------------
  // `order` lists row ids in log order; ids < n are clean rows, ids >= n are re-logged extra rows.
  const extraRows: Array<{ step: number; loss: number; lr: number; grad_norm: number }> = [];
  let order: number[] = Array.from({ length: n }, (_, i) => i);

  for (const d of rowDefects) {
    if (d.kind === 'gap') {
      const removed = new Set<number>();
      for (let i = d.from; i < d.from + d.length; i++) removed.add(i);
      order = order.filter((id) => !removed.has(id));
      truth.gaps.push({ fromStep: clean.step[d.from - 1], toStep: clean.step[d.from + d.length] });
    } else if (d.kind === 'relog') {
      const inserted: number[] = [];
      for (let i = d.from; i < d.from + d.length; i++) {
        extraRows.push({
          step: clean.step[i],
          loss: clean.loss[i] * Math.exp(LOSS_NOISE * gaussian(relogRng)),
          lr: clean.lr[i],
          grad_norm: clean.grad_norm[i] * Math.exp(GRAD_NOISE * gaussian(relogRng)),
        });
        inserted.push(n + extraRows.length - 1);
        truth.relogged.push({ step: clean.step[i], writes: 2 });
      }
      const after = order.indexOf(d.from + d.length - 1);
      order.splice(after + 1, 0, ...inserted);
      truth.unsorted = true;
    } else if (d.kind === 'swap-blocks') {
      for (const at of d.at) {
        const p = order.indexOf(at);
        const first = order.slice(p, p + d.size);
        const second = order.slice(p + d.size, p + 2 * d.size);
        order.splice(p, 2 * d.size, ...second, ...first);
      }
      truth.unsorted = true;
    }
  }

  const raw: Columns = {
    step: new Float64Array(order.length),
    loss: new Float64Array(order.length),
    lr: new Float64Array(order.length),
    grad_norm: new Float64Array(order.length),
  };
  order.forEach((id, k) => {
    const row = id < n ? null : extraRows[id - n];
    raw.step[k] = row ? row.step : clean.step[id];
    raw.loss[k] = row ? row.loss : clean.loss[id];
    raw.lr[k] = row ? row.lr : clean.lr[id];
    raw.grad_norm[k] = row ? row.grad_norm : clean.grad_norm[id];
  });
  return { spec, raw, truth };
}
