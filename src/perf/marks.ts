/**
 * Performance instrumentation shared by the naive and the optimized UI, so both are measured the
 * same way. Active only with `?perf` in the URL (no overhead otherwise).
 *
 *  - `chart:first-draw` mark: first time the loss chart is drawn WITH data. Its startTime is the
 *    time since navigation start ("first render").
 *  - `zoom` measure: from the input event that ends a zoom (mouseup of a drag, or a key press) to
 *    the next paint after the chart has drawn the data for the NEW range. For the optimized UI that
 *    includes the round trip to the worker, not just the first (stretched) redraw.
 *  - `hover` measure: from each pointermove on a chart to the next paint. The Event Timing API does
 *    not report pointermove at all (perf/experiments/verify-assumptions.txt, part B), so INP-style
 *    numbers for hover have to be measured by hand like this.
 *
 * "Next paint" = requestAnimationFrame, then a MessageChannel task: the rAF callback runs before
 * the frame is painted, the posted task runs after it.
 */
export const PERF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');

export function markOnce(name: string) {
  if (!PERF || performance.getEntriesByName(name, 'mark').length > 0) return;
  performance.mark(name);
}

export function measureToNextPaint(name: string, start: number) {
  if (!PERF) return;
  requestAnimationFrame(() => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => performance.measure(name, { start, end: performance.now() });
    ch.port2.postMessage(null);
  });
}

let zoomStart: number | null = null;

/** Call with event.timeStamp of the input that requests a new x range. */
export function zoomStarted(t: number) {
  if (PERF) zoomStart = t;
}

/** Call after the chart has drawn the data for the requested range. */
export function zoomSettled() {
  if (zoomStart === null) return;
  measureToNextPaint('zoom', zoomStart);
  zoomStart = null;
}
