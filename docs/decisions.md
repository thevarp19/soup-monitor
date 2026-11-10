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
