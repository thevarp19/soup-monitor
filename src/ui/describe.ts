/** Text alternatives for a chart: a screen-reader summary and the "this chart is downsampled" label. */
import type { Downsampled } from '../core/downsample.ts';
import { formatCount, formatStep, formatValue } from './format.ts';

const LABEL: Record<string, string> = { loss: 'Loss', lr: 'Learning rate', grad_norm: 'Gradient norm' };

function extentWithSteps(v: Pick<Downsampled, 'buckets'>) {
  const b = v.buckets;
  let minP = -1;
  let maxP = -1;
  for (let p = 0; p < b.min.length; p++) {
    if (!Number.isNaN(b.min[p]) && (minP < 0 || b.min[p] < b.min[minP])) minP = p;
    if (!Number.isNaN(b.max[p]) && (maxP < 0 || b.max[p] > b.max[maxP])) maxP = p;
  }
  return minP < 0 ? null : { min: b.min[minP], minStep: b.minStep[minP], max: b.max[maxP], maxStep: b.maxStep[maxP] };
}

export function notDrawableCounts(v: Pick<Downsampled, 'buckets'>) {
  const sum = (a: Float64Array) => a.reduce((s, x) => s + x, 0);
  const b = v.buckets;
  return { nan: sum(b.nan), posInf: sum(b.posInf), negInf: sum(b.negInf), nonPositive: sum(b.nonPositive) };
}

export function describeChart(metric: string, v: Pick<Downsampled, 'buckets' | 'sourceCount'>, x0: number, x1: number, locale: string): string {
  const label = LABEL[metric] ?? metric;
  const range = `steps ${formatStep(x0, locale)} to ${formatStep(x1, locale)}`;
  const e = extentWithSteps(v);
  const c = notDrawableCounts(v);
  const issues = [
    c.nan && `${formatCount(c.nan, locale)} NaN`,
    c.posInf && `${formatCount(c.posInf, locale)} +∞`,
    c.negInf && `${formatCount(c.negInf, locale)} −∞`,
    c.nonPositive && `${formatCount(c.nonPositive, locale)} values ≤ 0 (not representable on log scale)`,
  ].filter(Boolean);
  const notDrawn = issues.length ? ` Not drawn: ${issues.join(', ')}.` : '';
  if (!e) return `${label} chart, ${range}: no data that can be drawn.${notDrawn}`;
  return (
    `${label} chart, ${range}, ${formatCount(v.sourceCount, locale)} logged points. ` +
    `Visible minimum ${formatValue(e.min, locale)} at step ${formatStep(e.minStep, locale)}, ` +
    `maximum ${formatValue(e.max, locale)} at step ${formatStep(e.maxStep, locale)}.${notDrawn}`
  );
}

export function densityLabel(drawn: number, source: number, notDrawable: number, locale: string): string {
  if (drawn + notDrawable >= source) {
    return notDrawable > 0
      ? `All ${formatCount(source, locale)} points shown (${formatCount(notDrawable, locale)} not drawable, see markers)`
      : `All ${formatCount(source, locale)} points shown`;
  }
  return `Showing ${formatCount(drawn, locale)} of ${formatCount(source, locale)} points (min/max per pixel)`;
}
