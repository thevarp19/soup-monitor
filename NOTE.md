# NOTE — can you show this to someone deciding whether to stop a $500 run?

**Verdict: DON'T SHIP — yet. The chart is ready; the data path into it is not.**
What is on screen is proven truthful for the data it receives, but that data comes from an
in-browser mock. A real backend would first break the data contract, silently: JSON cannot carry
NaN (`JSON.stringify(NaN)` is `null`, which looks like a gap), and staleness is measured from the
client's receive time, not the server's newest step. **Change first:** an API that encodes NaN/±Inf
explicitly and returns the newest step's server timestamp; then run the existing truthfulness suite
on exported real runs. Second: pixel tests in Firefox and Safari.
Live: https://soup-monitor-seven.vercel.app/

## How I proved the chart is truthful

1M points do not fit in ~1,000 pixels, so something is discarded. Per pixel column the chart keeps
the **first, min, max and last** raw point (M4): every column's extremes survive by construction,
so a single spike cannot disappear (LTTB was rejected: it *selects* points, with no such guarantee).
Zooming re-computes from raw data. NaN/±Inf and gaps break the line and become markers — never 0,
never interpolated, never smoothed.

The tests compare with independent brute force, not with the implementation:
- the spike at step 500,000 (67.094…) is the maximum of the drawn data in 9 zoom windows × 3
  widths, and absent where it should be;
- property tests (1,000 random cases): per pixel column min/max equal the raw ones; every drawn
  point is a real raw point; no segment crosses a NaN, a gap or a value ≤ 0 on a log scale; axis
  labels parse back to the exact tick values;
- duplicated/shuffled input draws the oracle's line; cards equal a brute-force oracle in Node and
  in the browser; a canvas `getImageData` check finds the line at the spike's height;
- **mutation check:** 35 realistic bugs injected one at a time (every-2nd-point decimation, NaN → 0,
  a late response overwriting the run, …) — all caught.

Results (`results/`): 495 unit/property tests, also under 2 time zones × 3 locales; 48 e2e tests,
locally and against the deployed site.

**What the tests would not catch:** how uPlot paints (one pixel test; uPlot draws gaps by
*clipping*, so a spike next to a NaN could be partly clipped — untested); whether a human notices a
1-px spike; Firefox and Safari; data the generator does not produce; a misunderstanding shared by
generator, oracles and code (one author); whether the policies (last write wins, gap > 1.5× median
spacing) are right. Full list: `docs/truthfulness.md`.

## Performance (Chrome, CPU ×4, 1M points, median of 5 runs — `PERF.md`)

| | naive | final |
|---|---|---|
| Main thread blocked before the chart appears (TBT) | 1,496 ms | **34 ms** |
| Tab memory (renderer footprint, incl. worker) | 136 MB | **75 MB** |
| First render, measured / if the worker were throttled too | 1,700 ms | 636 / **1,599 ms** |
| Hover · zoom | 3.5 · 43 ms | 3.2 · 38 ms |

A Web Worker with transferred Float64Arrays stopped the page from freezing and cut memory by 45%
(a manual Task Manager check agrees: 131 → 72 MB). It did **not** make the data arrive faster:
DevTools throttling skips workers, so the honest first-render gain is ~6%, not 63%.

## Silent failures (`docs/silent-failures.md`)

Each was reproduced first, then fixed and pinned by a test:
- **request race** (A → B, A answers last): reproduced on the naive page (`test.fail`); fixed by
  aborting and letting only the latest request write; the same e2e passes on the real UI;
- **stale data:** a live run is polled; "Updated 15:10:21 GMT+5 · 12 seconds ago" counts from the
  last *successful* refresh, then **Stale**; a failed refresh keeps the data and says so;
- **locale / time zone:** `parseFloat("1,5")` silently returns 1, so typed numbers use a
  locale-aware parser; the locale is explicit and named, times carry their zone; the suite passes
  under 6 TZ × locale combinations, with a canary proving the environment took effect;
- **smoothing hides divergence:** EMA off by default, raw line always visible, and a warning when
  the EMA is >10% away from the recent raw values;
- **log scale with zeros:** values ≤ 0 never reach the plot; they are counted markers.

## Questions from the cancelled call

- **The chart is smooth — how do you know it is truthful?** Smoothness proves nothing: per-pixel
  extremes are kept by construction and compared with brute force; naive thinning makes 47 tests fail.
- **How to draw 5M points and lose nothing?** Drawing stays ≤ 4 points per pixel at any size; holding
  and scanning 5M points per zoom is the cost. Precompute a min/max pyramid (like map tiles),
  ideally server-side, and send only the level for the visible range.
- **What to show instead of NaN, and why?** A break in the line, a marker, and a count; "last loss"
  says NaN when the last value is NaN. NaN is often the most important signal on the page.
- **One hour before the deadline, what stays?** The truthful chart and its tests, then the silent
  failures, then performance; UI polish last.

## What surprised me, and what still concerns me

What surprised me most was how often the measuring tools were wrong in my favour. CPU throttling
skipped the worker, `JSHeapUsedSize` and Task Manager's "JavaScript memory" ignored it, LCP said
0.2 s while the naive chart took 1.7 s, and my own script reported "tab memory" as the sum of three
processes until a manual Task Manager check exposed it. A seeded generator also produced different
last bits in Node and Chrome (`Math.exp` is implementation-defined), and uPlot already thinned
points per pixel, so the naive version was slow but not untruthful. What still concerns me: one
author wrote the generator, the oracles and the code, so a shared misunderstanding would pass every
test; and the real data path — encoding of NaN, server timestamps — has not been built or tested.

*Written with Claude (Claude Code); how AI was used, and where it was wrong: `AI_USAGE.md`.*
