/**
 * Axis ranges, tick values and tick labels — our own, instead of the chart library's auto-scaling,
 * so that "the axis covers the data and the labels are the tick values" is a unit-testable claim.
 */
import type { Downsampled } from './downsample.ts';

export interface Ticks {
  /** Axis range: always [first tick, last tick], which covers the data. */
  min: number;
  max: number;
  ticks: number[];
  /** Distance between ticks (linear scales). */
  step: number;
}

const NICE = [1, 2, 2.5, 5, 10];

/** Nice step candidates ≥ raw, in increasing order. */
function* niceSteps(raw: number): Generator<number> {
  // Guard: log10(0) = −Infinity would make the loop below spin forever (it did: see decisions E7).
  if (!(raw > 0) || !Number.isFinite(raw)) throw new RangeError(`tick step must be finite and > 0, got ${raw}`);
  let exp = Math.floor(Math.log10(raw));
  for (;;) {
    const mag = Number(`1e${exp}`);
    if (!Number.isFinite(mag)) throw new RangeError(`no finite tick step ≥ ${raw}`);
    for (const m of NICE) {
      const s = Number((m * mag).toPrecision(12));
      if (s >= raw) yield s;
    }
    exp++;
  }
}

/** Round away floating-point noise from k · step. */
const clean = (v: number) => {
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r; // no -0
};

/**
 * Linear ticks whose first/last tick enclose [lo, hi]. At most max(3, maxTicks) ticks (the coverage
 * guard may add one at either end in rare floating-point cases). At least 3 are allowed because a
 * range that straddles 0 needs −s, 0, s; with 2 the search never terminated (found by fast-check).
 */
export function linearTicks(lo: number, hi: number, maxTicks: number): Ticks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new RangeError(`invalid extent [${lo}, ${hi}]`);
  const n = Math.max(3, Math.floor(maxTicks));
  if (!((hi - lo) / (n - 1) > 0)) {
    // Constant series (e.g. constant lr), or a span too small to divide (subnormal values):
    // pad around the value; if 10% of it underflows to 0, fall back to ±1.
    const pad = Math.abs(lo) * 0.1 > 1e-300 ? Math.abs(lo) * 0.1 : 1;
    hi = Math.max(hi, lo + pad);
    lo -= pad;
  }
  for (const step of niceSteps((hi - lo) / (n - 1))) {
    const first = Math.floor(lo / step);
    const last = Math.ceil(hi / step);
    if (last - first + 1 > n) continue;
    const ticks: number[] = [];
    for (let k = first; k <= last; k++) ticks.push(clean(k * step));
    if (ticks[0] > lo) ticks.unshift(clean((first - 1) * step));
    if (ticks[ticks.length - 1] < hi) ticks.push(clean((last + 1) * step));
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks, step };
  }
  throw new Error('unreachable');
}

/** Log ticks: decades enclosing [lo, hi] (with 2× and 5× when the range is ≤ 2 decades). lo must be > 0. */
export function logTicks(lo: number, hi: number, maxTicks = 8): Ticks {
  if (!(lo > 0) || !Number.isFinite(hi) || lo > hi) throw new RangeError(`log scale needs 0 < lo ≤ hi, got [${lo}, ${hi}]`);
  const pow = (e: number) => Number(`1e${e}`);
  let a = Math.floor(Math.log10(lo));
  let b = Math.ceil(Math.log10(hi));
  while (pow(a) > lo) a--;
  while (pow(b) < hi) b++;
  if (a === b) b++;
  const decades = b - a;
  const ticks: number[] = [];
  if (decades <= 2) {
    for (let e = a; e < b; e++) for (const m of [1, 2, 5]) ticks.push(Number(`${m}e${e}`));
    ticks.push(pow(b));
  } else {
    const every = Math.ceil(decades / (Math.max(2, maxTicks) - 1));
    const end = a + Math.ceil(decades / every) * every;
    for (let e = a; e <= end; e += every) ticks.push(pow(e));
  }
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks, step: NaN };
}

/**
 * Integer ticks inside [x0, x1] for the step axis: multiples of the smallest nice integer step that
 * gives at most maxTicks ticks. If that step has no multiple inside a narrow window (e.g. step 10
 * for [3384311, 3384317] — found by fast-check), fall back to one tick at the roundest integer in
 * the window instead of leaving the axis unlabelled.
 */
export function xTicks(x0: number, x1: number, maxTicks: number): number[] {
  const n = Math.max(2, Math.floor(maxTicks));
  if (!(x1 > x0)) return Number.isInteger(x0) ? [x0] : [];
  const tried: number[] = [];
  let step = 1;
  for (const s of niceSteps(Math.max(1, (x1 - x0) / (n - 1)))) {
    if (!Number.isInteger(s)) continue;
    step = s;
    break;
  }
  const ticks: number[] = [];
  for (let k = Math.ceil(x0 / step); k * step <= x1; k++) ticks.push(k * step);
  if (ticks.length > 0) return ticks;

  for (const s of niceSteps(1)) {
    if (s >= step) break;
    if (Number.isInteger(s)) tried.unshift(s);
  }
  for (const s of tried) {
    const k = Math.ceil(x0 / s) * s;
    if (k <= x1) return [k];
  }
  return [];
}

/** Number of decimals needed to write `step` exactly (2.5e-5 → 6, 0.1 → 1, 200 → 0 or negative). */
function decimalsOf(step: number): number {
  const [mant, exp] = Number(step.toPrecision(12)).toExponential().split('e');
  const mantDecimals = mant.includes('.') ? mant.split('.')[1].length : 0;
  return mantDecimals - Number(exp);
}
const exponentOf = (v: number) => Number(v.toExponential().split('e')[1]);

/**
 * Label for a linear tick: exactly as many digits as the tick spacing needs, so neighbouring
 * labels never collide ("0.0003, 0.0003") and each label is the tick value. Scientific notation
 * when the axis magnitude is < 1e-3 or ≥ 1e6. The locale is always explicit.
 */
export function formatTick(v: number, step: number, locale: string, magnitude = Math.abs(v)): string {
  if (v === 0) return new Intl.NumberFormat(locale).format(0);
  const decimals = decimalsOf(step);
  if (magnitude < 1e-3 || magnitude >= 1e6) {
    const sig = Math.min(21, Math.max(1, exponentOf(v) + decimals + 1));
    return new Intl.NumberFormat(locale, { notation: 'scientific', maximumSignificantDigits: sig }).format(v);
  }
  const d = Math.min(20, Math.max(0, decimals));
  return new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

/** Label for a log tick (values are m · 10^e with m ∈ {1, 2, 5}). */
export function formatLogTick(v: number, locale: string): string {
  if (v < 1e-3 || v >= 1e6) return new Intl.NumberFormat(locale, { notation: 'scientific', maximumSignificantDigits: 1 }).format(v);
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 1 }).format(v);
}

/** Label for a step tick: an integer with locale grouping. */
export function formatStepTick(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
}

/** Min and max of the drawable values in the visible range (from the per-column stats). */
export function visibleExtent(d: Downsampled): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  const { min: mins, max: maxs } = d.buckets;
  for (let p = 0; p < mins.length; p++) {
    if (mins[p] < min) min = mins[p];
    if (maxs[p] > max) max = maxs[p];
  }
  return min <= max ? { min, max } : null;
}
