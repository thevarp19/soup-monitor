# AI usage log

Kept during the work, not reconstructed at the end. The assistant was Claude (Claude Code CLI).
Fields per stage: *AI proposed* · *Accepted* and *Changed* (decisions of the author) · *Checked by
Claude* · *Where AI was wrong* · *Verified by me* (the author).

✎ At the author's request (2026-11-11) the *Accepted*, *Changed* and *Verified by me* fields were
drafted by Claude **only from what is recorded in the working session** — the author's messages and
the checks the author actually carried out and shared (screenshots, traces). They do not claim any
check that is not recorded there; the author may add checks made outside the session.

Times come from git commit timestamps (`git log --date=format:%H:%M`, UTC+5). A stage spans from
the previous stage's last commit to its own last commit, so the author's review time is included.

---

## Stage 0 — plan (repository created 17:42; no commits in this stage)

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
- **Changed:** — ✎
- **Where AI was wrong:** — (the four uncertain claims were checked by experiment in stage 3; all four held)
- **Verified by me:** ✎ Read the plan and the five open questions; asked to proceed with the
  recommended option for each. No independent technical check at this stage.

## Stage 1 — scaffold, generator, normalization (→ 18:15)

- **AI proposed:** Vite 8 + React 19 + TS strict, Vitest + fast-check, Playwright (no retries),
  ESLint flat config, CI workflow, a script that saves test output with a header (command, commit,
  exit code). Generator with a ground-truth manifest; normalization with last-write-wins for
  duplicates; an independent oracle in `tests/reference/`; property tests; a cross-check that
  normalization rediscovers every injected defect of the 20 catalogue runs.
- **Accepted:** ✎ approved the stage after reading the report ("Ok"), no change requests.
- **Changed:** — ✎ (pinning TypeScript 6.0.3 was the AI's own correction, listed below)
- **Checked by Claude (how):** tests were written first and run red (module missing) before each
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
- **Verified by me:** ✎ Read the stage report (test counts, mutation check, data policies). All
  tests of this stage were later re-run by the author — see "Author's re-run" at the end.

## Stage 2 — downsampling and truthfulness tests (18:15 → 18:40)

- **AI proposed:** M4 per device-pixel column with explicit guarantees (per-column min/max equal
  raw; every drawn point is a raw point; no segment across NaN/Inf/gap/≤0-on-log; every undrawable
  value counted in markers); per-column stats for the tooltip; debiased EMA with NaN skipped;
  finite-only summary statistics with "last loss" allowed to be NaN; own tick/label functions; a
  table of claims → tests and a list of blind spots (`docs/truthfulness.md`); a reusable mutation
  check (`pnpm test:mutation`).
- **Accepted:** ✎ approved the stage after reading the report ("Ok"), no change requests.
- **Changed:** — ✎
- **Checked by Claude (how):** each property test is compared against an independent brute-force
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
- **Verified by me:** ✎ Read the stage report (spike tests, property tests, mutation check, the
  tick-search hang and its fix). Tests and mutation check later re-run by the author — see
  "Author's re-run" at the end.

## Stage 3 — assumptions, naive baseline, perf script (18:40 → 19:06)

- **AI proposed:** verify the four uncertain stage-0 claims by experiment before measuring
  (`perf/experiments/verify-assumptions.ts`, `docs/experiments.md`); a deliberately naive UI kept
  for comparison; shared perf marks for both UIs; a CDP perf script (5 untraced runs + 1 traced
  run, four memory metrics, an "adjusted for unthrottled worker" first render).
- **Accepted:** ✎ approved the stage after reading the report ("Ok"), no change requests.
- **Changed:** — ✎
- **Checked by Claude (how):** all four stage-0 claims were checked in Chrome 157 and **all four
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
- **Verified by me:** ✎ Read the stage report (four assumption experiments, baseline numbers). The
  experiments and the first baseline were not independently re-run; that baseline was superseded in
  stage 4.

## Stage 4 — real UI, worker, e2e, "after" measurements (19:06 → 19:47)

- **AI proposed:** RunStore in a Web Worker with transferred typed arrays; race-safe
  `useRequest`; list with NaN-safe sorting and URL state; run page with cards, quality report,
  three charts (uPlot as renderer only, our ticks, markers, isolated-point dots, readout line,
  keyboard zoom, screen-reader summary); colour contrast unit-tested; e2e against a Node-side
  oracle incl. a canvas pixel check; `perf/report.ts` generating the PERF.md table from the files.
- **Accepted:** ✎ no change requests to the UI or the code; went on to the manual checks below.
- **Changed:** ✎ the memory methodology, as a result of the author's manual check: after the first
  Task Manager screenshot the script was changed to measure only the tab's renderer process, both
  measurements were redone, and pages got distinct titles so screenshots show which version is open.
- **Checked by Claude (how):** unit tests first for every pure module (red, then green); e2e
  runs; mutation check extended to 28 bugs (all caught); before/after measured on the same commit.
- **Where AI was wrong:**
  - **generator not reproducible across engines**: it used Math.exp/log/cos/pow, which differ in
    the last bit between Node 24 and Chrome 157 — the claim "same seed → same data everywhere" from
    stage 1 was false. Found by the e2e card test; generator rewritten with exact arithmetic;
    this changed the data, so the baseline had to be re-measured;
  - **the readout missed the spike by half a CSS pixel** on zoom levels where a CSS pixel spans
    several device columns; found by the e2e zoom test; fixed by merging the columns under the
    cursor;
  - **hover regression** in the first optimized version (3.6 → 6.6 ms): the readout state lived in
    the chart component, so every pointer move re-rendered three charts. Hypothesis checked against
    the trace (event dispatch time unchanged → cost was after the handler); fixed; re-measured;
  - the merge code first let a NaN-only column overwrite the min/max (`!(min <= NaN)` is true) —
    caught by a test written for it before the fix;
  - a comment in `useRequest` claimed abort alone cannot handle a same-tick response; inaccurate
    (both checks happen at settle time and are equivalent there) — corrected;
  - several wrong test expectations: an ambiguous text locator, a rounded range label, a pixel
    threshold that assumed DPR 2 while Playwright defaults to DPR 1, an arithmetic slip
    (12,497.5 + 2,499.5 = 14,997, not 14,998), and a tooltip test that built the view for one
    range and queried another;
  - a leftover no-op `.replace()` chain in `describeChart` and a `key={route.id}`-style masking
    risk were cleaned up before commit; `useMemo` over a value re-created every render (lint).
  - first after-measurement was presented by the raw number (−61% first render); the adjusted
    number for an unthrottled worker (−5%) is the honest comparison and is shown next to it;
  - **wrote the stage time ranges in this file by estimate** — stage 4's range ended at 20:50
    while it was 19:47. Replaced with times from git commit timestamps.
  - **"tab memory" was the sum of three renderer processes**, not the tab: the script took the
    footprint of every renderer of the headless browser (the tab + two others of ~11 and ~24 MB).
    **Found by the author**: the manual Chrome Task Manager screenshot showed ~80 MB where the
    script reported 113 MB. Fixed (tab = renderer with the most CPU time, others recorded),
    experiment and both measurements re-run: tab memory 136 → 76 MB (was reported as 175 → 113).
    Also added page titles — the screenshot could not tell the naive and the final page apart.
  - **instructions for the manual screenshots were insufficient**: "close the tab between the two
    pages" let Chrome load the second page into the same renderer process (same PID 53151), so
    the optimized page showed 180 MB. Caught from the PIDs in the screenshots; the fix was a fresh
    incognito window per page and the Task Manager search filter (the first screenshots also
    contained the author's unrelated tabs and e-mail, so they were not committed).
- **Verified by me:** ✎
  - **Tab memory in Chrome Task Manager** (own Chrome, not headless): the first screenshot showed
    80.3 MB for the optimized page where the script reported 113 MB — this exposed that the script
    summed three renderer processes. A second pair was discarded because both pages ran in the same
    renderer process (PID 53151). Final pair, a fresh incognito window per page, separate processes:
    naive 131 MB / JS 101,936 KB (PID 65886), optimized 72.4 MB / JS 4,096 KB (PID 67245) —
    `perf/screenshots/task-manager-*.png`; agrees with the corrected automated numbers (136 → 76 MB).
  - **Traces in DevTools → Performance** (`perf/trace-before.json`, `perf/trace-after.json`;
    screenshot `perf/screenshots/devtools-traces-before-after.png`): naive has a ~1.5 s long task on
    the main thread at load; in the optimized version that work is in the `dataWorker` track;
    Scripting 2,014 → 414 ms; LCP ≈ 0.2 s in both (the LCP element is text, not the chart).
  - Unit, e2e and mutation tests re-run by the author — see "Author's re-run" below.

## Stage 5 — silent failures (from 15:20 on 2026-11-11; see git log for commit times)

- **AI proposed:** reproduce each failure first (the race on the naive page with `test.fail`, the
  EMA lag and `Math.log10(0)` as characterization tests), then fix and test it; a live run with
  polling and a last-*successful*-update time; a locale-aware number parser and "Go to step"; the
  unit suite under 2 time zones × 3 locales with a canary; a smoothing-gap detector;
  `docs/silent-failures.md`.
- **Accepted:** ✎ "Ok, начинай этап 5"; after the stage: checked it in the app (below), no change requests.
- **Changed:** — ✎
- **Checked by Claude (how):** unit tests first where possible; e2e tests written after the code
  were run against the code without the change (stash) to see them fail; naive `test.fail` tests
  run without `test.fail` to confirm they fail on the data assertions; the canary run with a
  deliberately wrong expectation to confirm it can fail; mutation check extended to 35 (all caught,
  after one fix below).
- **Where AI was wrong:**
  - first check, before any code: `LANG` really changes Node's default `Intl` locale (risk from the
    plan) — confirmed, so the matrix is meaningful;
  - wrote raw invisible characters (no-break spaces, U+2212) into a regular expression instead of
    `\u` escapes — worked, but unreadable and fragile; caught by lint;
  - the `Freshness` test used jest-dom matchers that are not installed, and relied on RTL's
    auto-cleanup, which needs Vitest globals (off here) — fixed in the test;
  - the first version of the matrix script could not find the canary in Vitest's non-TTY output
    and reported all six combinations as failed while every test had passed — switched to the
    verbose reporter;
  - the mutation check showed a **real test gap**: comparing the EMA with single raw points instead
    of the recent mean was not caught; it would raise false alarms on noisy metrics; test added;
  - noticed that Playwright's `reuseExistingServer` would silently test a `vite preview` left
    running from the manual screenshots instead of the current code — fixed (own port, never reuse);
  - again ran a small test (`windowAround`) only after writing its implementation.
- **Verified by me:** ✎ (as reported by the author after the stage) checked in the running app
  (`pnpm dev`) and saw the described behaviour:
  - `/runs/live?poll=1000&stale=2500&fail=live@2` — the page turns **Stale** after a few seconds,
    the failed refresh is shown, the data stays;
  - `/runs/late-divergence` with EMA 0.999 — the smoothing warning appears;
  - `/runs/log-hostile` with log scale on — values ≤ 0 shown as ▼ markers with a count;
  - `/?locale=de-DE` — numbers formatted with a decimal comma.

## Author's re-run of all tests (2026-11-11, from 15:09 UTC+5, commit de608eb)

Run by the author in their own terminal on a clean working tree; output shared in the session.

| Command | Result |
|---|---|
| `pnpm test` | 17 test files, **434 passed** (started 15:09:32, 1.76 s) |
| `pnpm test:e2e` | **28 passed** (13.2 s, Chromium) |
| `pnpm test:mutation` | **28/28 mutations caught**; this run wrote `results/mutation-output.txt` (header: 2026-11-11T10:10:21Z, commit de608eb, exit code 0) |

Per-mutation failure counts differ slightly from the stage-2 file (e.g. "every 2nd point only":
41 → 47 failing tests) because tests were added in stage 4; every mutation is still caught.

