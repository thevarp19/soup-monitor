# Decision log

Every non-obvious choice, with the alternatives that were considered. NOTE.md links here instead
of repeating the reasoning.

## Interpretations of the brief

**I1 · "Tab memory".** Interpreted as the *Memory footprint* of the tab's renderer process in
Chrome Task Manager, because that is what a user's machine actually pays and it includes the
dedicated Web Worker (which runs in the same renderer process). Captured as a screenshot by hand.
The automated perf script additionally records:
- `performance.measureUserAgentSpecificMemory()` — includes workers and ArrayBuffers; needs
  cross-origin isolation (COOP/COEP headers on the preview server);
- `JSHeapUsedSize` (CDP `Performance.getMetrics`) and `performance.memory` — recorded but **not
  used for before/after comparison**: they cover only the main thread's V8 heap, so moving data
  into a worker, or into typed arrays whose backing store lives outside the V8 heap, would show a
  "saving" that the machine does not actually get. (To be verified empirically in stage 3.)

**I2 · "Spike visible at every zoom level".** Interpreted at the data level (the max of what is
handed to the chart equals the spike value at every tested range and width) plus one pixel-level
e2e check on the real canvas. Whether a human eye notices a 1-px-wide spike is out of scope for
automated tests and listed under "what the tests do not catch".

**I3 · "Stale data".** A monitor of a live run is only useful if it refreshes; without refresh,
"stale" is just a clock. One run (`live`) grows over time; its page polls, and the page is marked
stale when the last *successful* refresh is older than a threshold (e.g. while refreshes fail).

## Data policies (implemented in `src/core/normalize.ts`, mirrored in README)

**D1 · Duplicate steps: last write in log order wins.** The realistic source of duplicate steps is
a resume from checkpoint, which re-logs a range of steps; the newer values are the ones the run
continued from. Every overwrite is counted and shown.
Alternatives: first write wins (keeps values the run abandoned); mean of writes (invents a value
no one logged); keep all (breaks "one y per x" that a line chart needs); last *finite* write wins
(rejected: it would hide a NaN behind an older finite value — a silent failure by design).
Overwritten rows that contained NaN/Inf are counted separately (`overwrittenNonFinite`): "the run
hit NaN and was resumed" is exactly what a person deciding about a $500 run needs to know.

**D2 · NaN / ±Infinity values are kept**, never replaced with 0, interpolated or dropped. They
break the line and are drawn as markers (shape differs per kind). Counts are shown per metric.

**D3 · Rows with a non-finite *step* are dropped and counted** — there is no x position to draw
them at.

**D4 · Gap = spacing > 1.5 × median spacing** of the unique sorted steps. A single missing logging
interval is a gap (spacing = 2 × median), jitter up to 50% is not. The median is computed after
de-duplication, otherwise many duplicates (spacing 0) would shrink it and turn every step into a
"gap". Alternatives: a fixed expected interval (the client does not know it), a factor of 2 or 3
(would silently connect across one or two missing points).

## Engineering choices

**E1 · TypeScript 6.0.3, not 7.0.** TS 7 (the native compiler) is the latest, but
`typescript-eslint@8.72` supports only `<6.1`. Linting is worth more here than the compiler speed.

**E2 · `noUncheckedIndexedAccess` is off.** With it, every typed-array read in hot loops becomes
`number | undefined` and needs a `!`, which adds noise without adding runtime safety. The real
risk — an out-of-bounds read silently producing `undefined` → `NaN` — is covered by comparing
against an independent oracle (`tests/reference/`) on random inputs instead.

**E3 · Deterministic generator.** mulberry32 seeded per run. Noise is drawn in a fixed order
independent of the run's shape and defects, so adding a defect never changes any other value
(tested). The generator also returns a ground-truth manifest of what it injected; tests check that
normalization rediscovers exactly those facts from the data alone.

**E4 · Steps start at 0 and warmup lr is exactly 0 at step 0** (as in common linear-warmup
schedulers). This is realistic and it means the log-scale-with-zeros problem shows up on lr, not
only on the dedicated `log-hostile` run.

**E5 · Playwright `retries: 0`.** A retry would turn a flaky — i.e. real — failure into a quiet pass.

**E6 · Test output is saved with a header** (`scripts/run-and-save.mjs`): exact command, date,
commit, dirty flag, Node version, platform, exit code. A red run stays red in the file.

**E7 · Watchdog on test runs.** Vitest's `testTimeout` cannot interrupt a *synchronous* infinite
loop — when `linearTicks` looped forever on a subnormal value, the whole run hung with no output.
During development tests ran under an external alarm; CI has `timeout-minutes`. The root cause is
fixed and every step-search loop now throws on a non-finite/zero step instead of spinning.

## Chart pipeline (stage 2)

**C1 · Downsampling = M4 per device-pixel column**, recomputed from the raw normalized arrays for
the visible range on every call. Details:
- one raw point beyond each edge is included so the line reaches the plot edges; it is excluded
  from statistics, markers and the y-range (`interiorFrom/interiorTo`);
- a break is a `null` at the step of the first undrawable value (NaN, ±Inf, ≤ 0 on log), or
  half-way across a gap — so x stays strictly increasing and the null sits where the problem is;
- markers are aggregated per pixel column and kind (`step` = first occurrence, `count`);
- per-column stats (count, step range, min/max with their steps, counts per kind) are returned
  for the tooltip, so hover shows raw values without a round trip to the worker;
- ties: the earliest step, same as the summary cards.
Alternatives: LTTB (selects points — can drop a lone spike), every-nth / random sampling (drops
the spike — this exact bug is one of the mutations the tests catch), uPlot's built-in handling of
1M points (not under our control, and keeps 1M points in the main thread).

**C2 · EMA**: debiased (TensorBoard-style), index-based, computed on raw data; NaN/±Inf give NaN
at the same index and are skipped by the accumulator. Off by default (stage 4).

**C3 · Summary cards**: statistics over finite values only; NaN/±Inf are counted, never folded into
a number; "last loss" is the last *logged* value even if it is NaN, with the last finite value
shown separately; empty → `null`, never 0; plain loops (`Math.min(...arr)` throws a RangeError on
large arrays).

**C4 · Axes are computed by us, not by uPlot**: y range = [first tick, last tick] enclosing the
visible min/max; label digits derived from the tick spacing (so labels are unique and parse back
exactly); scientific notation below 1e-3 or from 1e6; locale always passed explicitly. At least 3
linear ticks (a range straddling 0 needs −s, 0, s). Step axis: integer ticks inside the window,
falling back to one tick at the roundest integer when the nice step has no multiple in a narrow
window.

## Performance methodology (stage 3)

**P1 · Real Google Chrome, headless, CPU ×4 via CDP**, viewport 1280×900, DPR 2, 5 runs in fresh
contexts (median and min–max reported) + 1 separate traced run (tracing adds overhead, so the trace
is for inspection, not for the numbers). `?latency=0` so mock-API latency does not enter the numbers.

**P2 · What is measured** (`src/perf/marks.ts`, identical for naive and optimized UI):
first render = `chart:first-draw` mark (navigation start → first loss chart draw with data);
zoom = mouseup → next paint after the new range is drawn; hover = pointermove → next paint;
TBT = sum of (long task − 50 ms) before first render; memory after GC.

**P3 · Known biases, measured in `docs/experiments.md`:** worker work is not throttled (adjusted
upper bound reported); Event Timing does not cover hover; `JSHeapUsedSize` misses ArrayBuffers and
workers. In headless Chrome, "next paint" is not aligned to a 60 Hz display, so hover/zoom times do
not include the up-to-16 ms wait for vsync a real display adds.

**P4 · The naive baseline is untested on purpose** — it is a throwaway reference for measurements,
tagged `perf-baseline` and kept reachable at `?impl=naive`. It does contain the known silent
failures (NaN hidden as gaps, no duplicate handling, request race), which stage 5 uses as the
"reproduce first" step.

## Planned (decided in stage 0, implemented later)

- **Log scale with values ≤ 0: hide + mark + count.** Points ≤ 0 break the line, are drawn as
  markers on the bottom edge, and a banner says "N points ≤ 0 not representable on log scale".
  Not "disable log scale": lr with warmup starts at exactly 0, so a single zero would make log
  scale permanently unavailable for lr.
- **Downsampling: M4** (first/min/max/last per device-pixel column), recomputed from the raw data
  for the visible range on every zoom. Not LTTB: it *selects* "visually important" points and can
  drop a single spike in a noisy region.
- **EMA is computed on the raw data**, then downsampled like any other series. Computing it on the
  downsampled data would make the smoothing change with zoom.
- **Race-free fetching by hand** (AbortController + request id) instead of TanStack Query, so the
  bug and the fix are visible and testable.
- **Naive pipeline kept** behind `?impl=naive` (lazy chunk) in addition to the `perf-baseline`
  tag, so before/after can be re-measured under identical conditions at any time.
- **Deploy to Vercel** (SPA rewrite + custom COOP/COEP headers are possible; GitHub Pages cannot
  set headers).
