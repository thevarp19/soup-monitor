import { describe, expect, it } from 'vitest';
import { downsample } from '../core/downsample.ts';
import { readoutAt, readoutBetween } from './tooltip.ts';

const view = (x: number[], y: number[], width: number, log = false) =>
  downsample({
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    gapStarts: new Uint32Array(0),
    x0: x[0],
    x1: x[x.length - 1],
    width,
    log,
  });

describe('readoutAt — what the tooltip shows at a step', () => {
  it('one raw point in the pixel: the exact point', () => {
    const v = view([0, 10, 20], [1.5, 2.5, 3.5], 100);
    expect(readoutAt(v, 0, 20, 10)).toEqual({ kind: 'point', step: 10, value: 2.5 });
  });

  it('many raw points in the pixel: min and max with their steps, and how many points', () => {
    const v = view([0, 1, 2, 3, 4, 5, 6, 7], [5, 1, 9, 6, 7, NaN, 8, 2], 2);
    expect(readoutAt(v, 0, 7, 6)).toEqual({
      kind: 'range',
      fromStep: 4,
      toStep: 7,
      count: 4,
      min: 2,
      minStep: 7,
      max: 8,
      maxStep: 6,
      nan: 1,
      posInf: 0,
      negInf: 0,
      nonPositive: 0,
    });
  });

  it('a single NaN in the pixel is reported as NaN, not skipped', () => {
    const v = view([0, 10, 20], [1, NaN, 3], 100);
    expect(readoutAt(v, 0, 20, 10)).toEqual({ kind: 'point', step: 10, value: NaN });
  });

  it('an empty pixel (zoomed in between logged steps): the nearest logged step', () => {
    const v = view([0, 100], [1, 2], 100);
    expect(readoutAt(v, 0, 100, 30)).toEqual({ kind: 'point', step: 0, value: 1, nearest: true });
    expect(readoutAt(v, 0, 100, 80)).toEqual({ kind: 'point', step: 100, value: 2, nearest: true });
  });

  it('nothing at all in the visible range → null', () => {
    const v = downsample({ x: Float64Array.from([0, 100]), y: Float64Array.from([1, 2]), gapStarts: new Uint32Array(0), x0: 200, x1: 300, width: 10, log: false });
    expect(readoutAt(v, 200, 300, 250)).toBeNull();
  });
});

describe('readoutBetween — the cursor covers a whole CSS pixel, i.e. several device-pixel columns', () => {
  // 8 points over 4 columns; the spike (99) is in column 3. A cursor whose CSS pixel spans
  // columns 2–3 must report it even if its centre maps to column 2.
  const v = view([0, 1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 99, 8], 4);

  it('merges the columns: max is the spike, with its step and the total count', () => {
    expect(readoutBetween(v, 0, 7, 3.6, 7)).toMatchObject({ kind: 'range', count: 4, max: 99, maxStep: 6, min: 5, minStep: 4, fromStep: 4, toStep: 7 });
  });

  it('a column holding only NaN does not wipe out the min/max of its neighbours', () => {
    const w = view([0, 1, 2, 3], [1, NaN, NaN, 5], 4);
    expect(readoutBetween(w, 0, 3, 0, 3)).toMatchObject({ kind: 'range', count: 4, min: 1, max: 5, nan: 2 });
  });

  it('a single column is the same as readoutAt', () => {
    expect(readoutBetween(v, 0, 7, 0.5, 0.5)).toEqual(readoutAt(v, 0, 7, 0.5));
  });
});

