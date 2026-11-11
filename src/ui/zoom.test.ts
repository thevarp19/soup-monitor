import { describe, expect, it } from 'vitest';
import { isFullRange, panBy, rangeFromSelection, windowAround, zoomBy } from './zoom.ts';

const full = { x0: 0, x1: 1000 };

describe('zoomBy', () => {
  it('zooms in by 2× around the centre', () => {
    expect(zoomBy({ x0: 0, x1: 1000 }, full, 0.5)).toEqual({ x0: 250, x1: 750 });
  });

  it('zooms out and clamps to the full range', () => {
    expect(zoomBy({ x0: 400, x1: 600 }, full, 2)).toEqual({ x0: 300, x1: 700 });
    expect(zoomBy({ x0: 0, x1: 600 }, full, 4)).toEqual({ x0: 0, x1: 1000 });
  });

  it('keeps the span when clamping at an edge', () => {
    expect(zoomBy({ x0: 900, x1: 1000 }, full, 2)).toEqual({ x0: 800, x1: 1000 });
  });

  it('does not zoom in below the minimum span', () => {
    const r = zoomBy({ x0: 495, x1: 505 }, full, 0.1, 10);
    expect(r.x1 - r.x0).toBe(10);
  });
});

describe('panBy', () => {
  it('moves by a fraction of the span and stops at the edges without shrinking', () => {
    expect(panBy({ x0: 400, x1: 600 }, full, 0.1)).toEqual({ x0: 420, x1: 620 });
    expect(panBy({ x0: 900, x1: 1000 }, full, 0.5)).toEqual({ x0: 900, x1: 1000 });
    expect(panBy({ x0: 0, x1: 100 }, full, -0.5)).toEqual({ x0: 0, x1: 100 });
  });
});

describe('rangeFromSelection', () => {
  it('orders the ends and clamps to the full range', () => {
    expect(rangeFromSelection(700, 200, full)).toEqual({ x0: 200, x1: 700 });
    expect(rangeFromSelection(-50, 2000, full)).toEqual({ x0: 0, x1: 1000 });
  });

  it('ignores a selection narrower than the minimum span (a click, not a drag)', () => {
    expect(rangeFromSelection(500, 503, full, 10)).toBeNull();
  });
});

describe('isFullRange', () => {
  it('true only for the whole range', () => {
    expect(isFullRange(full, full)).toBe(true);
    expect(isFullRange({ x0: 1, x1: 1000 }, full)).toBe(false);
  });
});

describe('windowAround (Go to step)', () => {
  it('a window of 1/50 of the run centred on the step', () => {
    expect(windowAround(500, full, 1 / 50)).toEqual({ x0: 490, x1: 510 });
  });
  it('clamped at the edges, keeping its width', () => {
    expect(windowAround(0, full, 1 / 50)).toEqual({ x0: 0, x1: 20 });
  });
  it('never narrower than the minimum span', () => {
    expect(windowAround(500, full, 1 / 1000, 10)).toEqual({ x0: 495, x1: 505 });
  });
});

