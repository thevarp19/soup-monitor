import { describe, expect, it } from 'vitest';
import { downsample } from '../core/downsample.ts';
import { densityLabel, describeChart } from './describe.ts';

const v = downsample({
  x: Float64Array.from([0, 10, 20, 30, 40]),
  y: Float64Array.from([3, NaN, 62.5, Infinity, 1]),
  gapStarts: new Uint32Array(0),
  x0: 0,
  x1: 40,
  width: 800,
  log: false,
});

describe('describeChart — text alternative for screen readers', () => {
  const text = describeChart('loss', v, 0, 40, 'en-US');

  it('states the visible range, the extremes with their steps, and non-finite counts', () => {
    expect(text).toContain('steps 0 to 40');
    expect(text).toContain('minimum 1 at step 40');
    expect(text).toContain('maximum 62.5 at step 20');
    expect(text).toContain('1 NaN');
    expect(text).toContain('1 +∞');
  });

  it('says plainly when nothing can be drawn', () => {
    const empty = downsample({ x: new Float64Array(0), y: new Float64Array(0), gapStarts: new Uint32Array(0), x0: 0, x1: 1, width: 10, log: false });
    expect(describeChart('loss', empty, 0, 1, 'en-US')).toContain('no data');
  });
});

describe('densityLabel — the chart says it is downsampled', () => {
  it('"Showing N of M points" when points were merged', () => {
    expect(densityLabel(1_600, 1_000_000, 0, 'en-US')).toBe('Showing 1,600 of 1,000,000 points (min/max per pixel)');
  });
  it('all points when nothing was merged', () => {
    expect(densityLabel(40, 40, 0, 'en-US')).toBe('All 40 points shown');
  });
  it('points that cannot be drawn are not presented as "merged away"', () => {
    expect(densityLabel(38, 40, 2, 'en-US')).toBe('All 40 points shown (2 not drawable, see markers)');
  });
});
