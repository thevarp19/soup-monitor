/** Zoom/pan arithmetic for the step axis — pure, shared by drag-select and keyboard control. */
export interface Range {
  x0: number;
  x1: number;
}

export const MIN_SPAN = 10;

/** Fit `r` inside `full`, keeping its span when possible. */
export function clampRange(r: Range, full: Range): Range {
  const span = Math.min(r.x1 - r.x0, full.x1 - full.x0);
  let x0 = r.x0;
  if (x0 < full.x0) x0 = full.x0;
  if (x0 + span > full.x1) x0 = full.x1 - span;
  return { x0, x1: x0 + span };
}

/** factor < 1 zooms in, > 1 zooms out, around the centre of the current range. */
export function zoomBy(r: Range, full: Range, factor: number, minSpan = MIN_SPAN): Range {
  const c = (r.x0 + r.x1) / 2;
  const span = Math.min(full.x1 - full.x0, Math.max(minSpan, (r.x1 - r.x0) * factor));
  return clampRange({ x0: c - span / 2, x1: c + span / 2 }, full);
}

/** Move by a fraction of the current span (negative = left). */
export function panBy(r: Range, full: Range, fraction: number): Range {
  const d = (r.x1 - r.x0) * fraction;
  return clampRange({ x0: r.x0 + d, x1: r.x1 + d }, full);
}

/** Range from a drag selection; null for a selection narrower than minSpan (a click). */
export function rangeFromSelection(a: number, b: number, full: Range, minSpan = MIN_SPAN): Range | null {
  const x0 = Math.max(Math.min(a, b), full.x0);
  const x1 = Math.min(Math.max(a, b), full.x1);
  return x1 - x0 < minSpan ? null : { x0, x1 };
}

export const isFullRange = (r: Range, full: Range) => r.x0 <= full.x0 && r.x1 >= full.x1;
