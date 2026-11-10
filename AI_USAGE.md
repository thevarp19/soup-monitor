# AI usage log

Kept during the work, not reconstructed at the end. The assistant was Claude (Claude Code CLI).
The "Verified by me" field is filled in by the author only.

Times are wall-clock (UTC+5), approximate, taken from the session and file timestamps.

---

## Stage 0 — plan (17:42–17:55)

- **AI proposed:** folder structure (pure `src/core/` + thin React layer), M4 downsampling instead
  of LTTB, tooltip that shows the whole pixel bucket (min/max with their steps) when zoomed out,
  own y-range/tick functions so axis labels are unit-testable, EMA on raw data, "hide + mark" for
  log scale, manual race handling instead of TanStack Query, test oracle, 20-run catalogue.
  Flagged four measurement traps it was *not sure about* and marked them "to verify": CPU throttling
  may not apply to Web Workers; `JSHeapUsedSize` excludes worker heaps and possibly ArrayBuffer
  backing stores; Event Timing API may not report `pointermove`; uPlot may already collapse
  same-pixel points internally.
- **Accepted:** all recommendations (Vercel, "tab memory" interpretation, live run + polling,
  naive pipeline behind `?impl=naive`, hide + mark for log scale).
- **Changed:** —
- **Where AI was wrong:** — (the four uncertain claims are still unverified; see stage 3)
- **Verified by me:**

## Stage 1 — scaffold, generator, normalization (17:55–18:15)

- **AI proposed:** Vite 8 + React 19 + TS strict, Vitest + fast-check, Playwright (no retries),
  ESLint flat config, CI workflow, a script that saves test output with a header (command, commit,
  exit code). Generator with a ground-truth manifest; normalization with last-write-wins for
  duplicates; an independent oracle in `tests/reference/`; property tests; a cross-check that
  normalization rediscovers every injected defect of the 20 catalogue runs.
- **Accepted:** as proposed.
- **Changed:** pinned TypeScript 6.0.3 instead of the latest 7.0.2 (see decisions E1).
- **What was checked and how:** tests were written first and run red (module missing) before each
  implementation. Afterwards a manual mutation check on `normalize.ts`: three injected bugs
  (first-write-wins, `>=` in the gap rule, NaN → 0) — each made tests fail. The `>=` mutation was
  caught only by the oracle comparison, so an explicit boundary test was added and verified to fail
  on that mutation and pass on the real code.
- **Where AI was wrong:**
  - used the legacy `reactHooks.configs['recommended-latest']` in the flat ESLint config → ESLint
    crashed; fixed to `configs.flat['recommended-latest']`;
  - first picked TypeScript 7.0.2, which `typescript-eslint` does not support (found from peer deps
    before installing);
  - wrote a generator test expecting negative loss with an offset of 2.5, but the clean curve ends
    at ≈ 2.65, so it could never go negative; noticed while writing the catalogue, before running;
  - left an unused variable in the first draft of `generate.ts` (removed before the first run);
  - added redundant `!` non-null assertions on typed-array reads (69 lint errors) although
    `noUncheckedIndexedAccess` is off by its own decision E2; removed;
  - the output-saving script needed three iterations: its "dirty tree" flag fired because of the
    results file it had just written itself, and its colour handling was wrong twice (Vitest turns
    colours *on* when `FORCE_COLOR` is merely present, even `FORCE_COLOR=0`; Playwright sets
    `FORCE_COLOR` for its children, so a global `NO_COLOR` produced Node warnings). Each iteration
    is a separate commit.
- **Verified by me:**

## Stage 2 — downsampling and truthfulness tests (18:20–19:05)

- **AI proposed:** M4 per device-pixel column with explicit guarantees (per-column min/max equal
  raw; every drawn point is a raw point; no segment across NaN/Inf/gap/≤0-on-log; every undrawable
  value counted in markers); per-column stats for the tooltip; debiased EMA with NaN skipped;
  finite-only summary statistics with "last loss" allowed to be NaN; own tick/label functions; a
  table of claims → tests and a list of blind spots (`docs/truthfulness.md`); a reusable mutation
  check (`pnpm test:mutation`).
- **Accepted:** —  *(author to fill in)*
- **Changed:** —  *(author to fill in)*
- **What was checked and how:** each property test is compared against an independent brute-force
  computation inside the test; hand-computed literals for the core cases; mutation check — 22
  injected bugs, all caught (after the fixes listed below).
- **Where AI was wrong:**
  - **`linearTicks` hung forever** on a subnormal constant (5e-324 · 0.1 underflows to 0 →
    log10(0) = −∞ → the step search never ends). Found when the property test run hung with no
    output; reproduced in isolation with a 10 s alarm; fixed with a guard and a regression test;
  - `linearTicks` returned NaN ticks for a range straddling 0 with a 2-tick budget, and `xTicks`
    returned no ticks for a narrow window — both found by fast-check counterexamples;
  - wrote two literal expectations that contradicted its own algorithm (`xTicks` step for a 20-step
    window; the regression test after raising the tick budget to 3) — caught before/at first run;
  - wrote the tests for `ema`, `summary`, `scale` first but did not run them red before writing
    the implementation; corrected by temporarily removing the modules and watching the tests fail;
  - the mutation check initially reported 2 survivors: one was a badly designed mutation (an
    equivalent mutant — the coverage guard compensated), the other a **real gap in the tests**
    (`visibleExtent` never had its max in the last pixel column) → test added, now 22/22 caught;
  - left a dummy test with an unused constant in the first draft of `downsample.test.ts` (removed).
- **Verified by me:**

## Stage 3 — assumptions, naive baseline, perf script (19:10–19:45)

- **AI proposed:** verify the four uncertain stage-0 claims by experiment before measuring
  (`perf/experiments/verify-assumptions.ts`, `docs/experiments.md`); a deliberately naive UI kept
  for comparison; shared perf marks for both UIs; a CDP perf script (5 untraced runs + 1 traced
  run, four memory metrics, an "adjusted for unthrottled worker" first render).
- **Accepted:** —  *(author to fill in)*
- **Changed:** —  *(author to fill in)*
- **What was checked and how:** all four stage-0 claims were checked in Chrome 157 and **all four
  held**: uPlot collapses points per pixel internally (source read); page CPU throttling does not
  slow a worker (×1.02) and Chrome refuses to throttle worker targets; Event Timing reports no
  pointermove/mousemove; CDP `JSHeapUsedSize` misses ArrayBuffer backing stores and workers.
  One result was *not* predicted: `performance.memory.usedJSHeapSize` **does** count the
  ArrayBuffers (32.4 MB) while CDP `JSHeapUsedSize` does not (1.9 MB) — two "heap" numbers from
  the same page differ by the whole data set.
- **Where AI was wrong:**
  - first attempt to throttle the worker via its CDP target read the wrong message (an
    `Inspector.workerScriptLoaded` event instead of the command's reply) and printed it as the
    result; fixed by waiting for the reply with the matching id, which turned out to be an error;
  - wrote `<NaiveRunPage key={route.id}>`, which remounts the page on every run switch and would
    have **hidden the request race** the naive page is supposed to reproduce; removed before commit;
  - the naive page sets state at the start of an effect (React lint error); kept on purpose in the
    baseline only, with a scoped `eslint-disable` and a comment.
- **Verified by me:**
