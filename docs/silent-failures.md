# Silent failures: what looks fine but is wrong

For each one: what the user would see, how it was reproduced **before** fixing, the fix, the test
that keeps it fixed, and what is still open. Test output: `results/test-output.txt`,
`results/e2e-output.txt`, `results/test-intl-output.txt`; mutation check: `results/mutation-output.txt`.

## The five from the brief

### 1. Request race when switching runs quickly

- **Looks fine:** the page title says run B; the chart and cards show run A's data.
- **Reproduced:** `e2e/race.spec.ts` on the naive page (`?impl=naive`), with per-run latency so the
  order of answers is deterministic: A → B where A's answer arrives after B's (B's title, A's
  "5,000 points"), and A → B → A where B's answer arrives after switching back (B's data flashes
  under A). Both are `test.fail` — they fail on exactly those data assertions (checked).
- **Fix:** `useRequest` — the superseded request is aborted *and* an answer may write state only if
  it belongs to the latest request (checking at answer time; relying on the fetcher to honour the
  abort is not enough). A new run id never shows the previous run's data; the zoom range is stored
  with its run id; charts are keyed by run.
- **Tests:** `useRequest.test.tsx` (A→B late A, A→B→A, a stale error, test fetchers that ignore the
  abort signal); the same e2e scenarios pass on the real UI. Mutation "a late response may
  overwrite the current run" is caught.
- **Open:** the worker cannot be interrupted mid-computation; an aborted request's work still runs
  and its answer is dropped.

### 2. Stale data

- **Looks fine:** a chart that stopped updating looks exactly like a run whose loss stopped changing.
- **Reproduced:** the naive page loads once, never refreshes, and shows no time. In the first real
  UI, a failed refresh even replaced the chart with an error page.
- **Fix:** the live run keeps growing and is polled; the page shows "Updated HH:MM:SS <zone> · N
  seconds ago" from the last **successful** update, turns **Stale** after a threshold, and a failed
  refresh keeps the last data with "Last refresh failed: …" instead of blanking it.
- **Tests:** `Freshness.test.tsx` with fake timers (29 s fresh, 31 s stale, failed refresh, finished
  runs never stale); `time.test.ts` (`isStale` boundary); `useRequest` keeps data on a failed
  refresh; e2e `stale.spec.ts` (`?fail=live@2&poll=1000&stale=2500`: data stays, failure shown,
  Stale appears) — all seen failing without the fix.
- **Open:** "updated" is the client's receive time, not a server timestamp of the newest step;
  thresholds (10 s poll, 30 s stale) are arbitrary.

### 3. Locale and time zone

- **Looks fine:** `1.235` (de-DE for 1,235) read by an English reader; `15:10` without a zone;
  `parseFloat("1,5")` is **1**, silently; Asia/Almaty was UTC+6 until 2024, so old timestamps in tests
  show a different offset than today's.
- **Reproduced:** characterization tests (`parse.test.ts`: `parseFloat("1,5") === 1`,
  `Number("1,5")` is NaN).
- **Fix:** every formatter receives the locale explicitly (browser locale or `?locale=`, named in
  the footer); times always carry their zone; `parseUserNumber` reads "1,5" and "1.5" as 1.5 in
  every locale, applies grouping only by explicit rules ("1,500" = 1500 in en-US, 1.5 in de-DE),
  and rejects what it cannot read; "Go to step" uses it and refuses non-integers.
- **Tests:** formatting table for en-US/de-DE/ru-RU; times in explicit zones; parser cases;
  **`pnpm test:intl` runs the whole unit suite under 2 time zones × 3 locales**, with a canary test
  proving each environment really reached `Intl` (and seen failing on a mismatch); e2e with the
  browser locale/zone emulated (cards formatted and equal to the oracle, zone named, Go to step).
- **Open:** axis tick labels are drawn on canvas — tested as functions, not read back from the
  screen; right-to-left locales not tested.

### 4. Smoothing that hides divergence

- **Looks fine:** with EMA 0.999 the curve keeps going down while the run is already diverging.
- **Reproduced:** `divergence.test.ts` — on `late-divergence` the raw loss at the last step is more
  than 1.5× the EMA 0.999 value.
- **Fix:** EMA is off by default; when on, the raw line stays visible (70% opacity, still ≥ 3:1
  contrast, unit-tested) and the EMA is dashed; the EMA is computed on raw data, not on the
  downsampled view (else it would change with zoom); a detector compares the EMA with the mean of
  the last 20 raw points and warns above 10%: "at step X the smoothed line is N% below the recent
  raw values".
- **Tests:** detector unit tests (late divergence flagged near the end and "below"; light smoothing
  not flagged; a step; **noise alone not flagged** — added after the mutation check showed that
  comparing with single raw points was not caught); store; e2e (warning appears for 0.999 and
  points at the last 5% of the run; none for a healthy run with 0.6).
- **Open:** 10% / 20 points are judgement calls; the EMA is index-based across gaps; the warning
  covers the visible range only.

### 5. Log scale with zeros

- **Looks fine:** a zero becomes −∞ (a line to the bottom edge) or a negative becomes NaN (the point
  silently disappears) — `Math.log10(0) = −Infinity`, `Math.log10(−2) = NaN` (characterization test).
- **Fix:** on a log scale, values ≤ 0 are never handed to the plot: the line breaks there, they are
  drawn as ▼ markers on the bottom edge, and each chart states the count. The log axis refuses a
  non-positive minimum instead of inventing one. (Not "disable log scale": lr with warmup is exactly
  0 at step 0, so one zero would make log scale useless for lr.)
- **Tests:** downsample unit tests (`nonpositive` markers, line breaks); `logTicks` refuses ≤ 0; e2e
  on `log-hostile`: the counts equal the oracle's for loss and lr, and nothing ≤ 0 reaches uPlot.

## Found along the way (not in the brief)

| What looked fine but was wrong | Found by | Now covered by |
|---|---|---|
| Sorting the list by last loss: NaN makes the comparator return NaN → order silently implementation-defined | design review | `listModel.test.ts`, mutation |
| "Last loss" card showing the last *finite* value hides that the run just produced NaN | design review | `summary.test.ts`, e2e, mutation |
| Same seed, different data in Node and Chrome (`Math.exp/log/cos` are implementation-approximated) | e2e card test | exact-arithmetic generator, golden test |
| Hovering exactly over the spike after zooming showed the neighbouring half pixel (HiDPI) | e2e zoom test | readout merges the columns under the cursor; e2e at DPR 1 and 2 |
| A tick search looped forever on subnormal values (a synchronous loop no test timeout can stop) | property test | regression test, guard, CI timeout |
| `JSHeapUsedSize` and Task Manager's "JavaScript memory" ignore the worker and ArrayBuffers (fake −97%) | experiment before measuring | `docs/experiments.md`, PERF.md footnote |
| DevTools CPU throttling does not apply to workers (fake −61% first render) | experiment | adjusted row in PERF.md |
| LCP ≈ 0.2 s in both versions while the naive chart appears after ~1.7 s | DevTools trace | custom `chart:first-draw` mark |
| "Tab memory" summed three renderer processes | author's manual Task Manager check | tab-only footprint, re-measured |
| Playwright reused a `vite preview` left running by hand → e2e could test an old build | review of the config | own port, `reuseExistingServer: false` |
| A real JSON API cannot carry NaN (`JSON.stringify(NaN)` is `null` — indistinguishable from a gap; Python's `NaN` literal breaks `JSON.parse`) | design review | **not implemented** — the mock passes typed arrays; a real integration must encode non-finite values explicitly |
