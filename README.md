# Soup — training run monitor

A training-run monitor built to answer one question: *can you show this chart to someone deciding
whether to stop a $500 run?* The focus is on the chart being **truthful**, not just looking right.

**Live: https://soup-monitor-seven.vercel.app/** — try [the 1M-point run](https://soup-monitor-seven.vercel.app/runs/long-1m),
[all defects at once](https://soup-monitor-seven.vercel.app/runs/kitchen-sink),
[a live run whose refreshes fail](https://soup-monitor-seven.vercel.app/runs/live?poll=1000&stale=2500&fail=live@2),
or [the naive baseline](https://soup-monitor-seven.vercel.app/runs/long-1m?impl=naive).

**Verdict: DON'T SHIP — yet.** The chart is proven truthful for the data it receives; the data
path from a real backend (NaN over JSON, server timestamps) is not built. Details: [NOTE.md](NOTE.md).

| Document | What is in it |
|---|---|
| [NOTE.md](NOTE.md) | the two-page answer: truthfulness, blind spots, performance, silent failures, verdict |
| [docs/truthfulness.md](docs/truthfulness.md) | each claim about the chart → the test that proves it; what the tests cannot catch |
| [docs/silent-failures.md](docs/silent-failures.md) | what looks fine but is wrong: reproduction, fix, test, what is still open |
| [PERF.md](PERF.md) | before/after table (generated from `perf/results-*.json`), traces, Task Manager check |
| [docs/experiments.md](docs/experiments.md) | the measurement traps checked before measuring (throttling, memory, Event Timing, uPlot) |
| [docs/decisions.md](docs/decisions.md) | every non-obvious decision and its alternatives |
| [AI_USAGE.md](AI_USAGE.md) | where AI was used, what was accepted/changed/verified, and where it was wrong |
| `results/` | saved test output, as is (unit, TZ × locale matrix, e2e local and deployed, mutation check) |

## Run it

```bash
pnpm install
pnpm dev                # http://localhost:5173
pnpm test               # unit + property tests (Vitest + fast-check)
pnpm test:e2e           # Playwright (builds and serves the app on :4173)
pnpm test:save          # unit tests, output saved to results/test-output.txt
pnpm test:e2e:save      # e2e tests, output saved to results/e2e-output.txt
pnpm test:mutation      # inject 35 known bugs one by one, check the tests catch each one
pnpm test:intl          # whole unit suite under 2 time zones × 3 locales (+ canary)
pnpm perf:before        # naive pipeline (?impl=naive), Chrome, CPU ×4 → perf/results-before.json
pnpm perf:after         # optimized UI → perf/results-after.json
pnpm perf:report        # regenerate the table in PERF.md from the result files
pnpm typecheck && pnpm lint
```

First Playwright run: `pnpm exec playwright install chromium`.

## Deploy (Vercel)

`vercel.json` builds with pnpm, serves `dist/`, rewrites every path to `index.html` (client-side
routes; real files take precedence) and sends `Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy` (cross-origin isolation, needed by
`performance.measureUserAgentSpecificMemory()`; the app loads no third-party resources).
Import the GitHub repository at vercel.com/new — no other settings needed.
Check the deployed site with the same e2e suite: `pnpm test:e2e:deployed`
(or `E2E_BASE_URL=https://<deployment> pnpm test:e2e`).

## Data

`src/core/runSpecs.ts` defines 20 runs (seeded, fully deterministic — `src/core/generate.ts`):
healthy runs with three lr schedules, divergence, late divergence, plateau, gradient explosion,
isolated NaN, a NaN series, ±Infinity, duplicate steps (resume from checkpoint), unsorted steps,
gaps, a 1,000,000-point run with one spike at step 500,000, zeros/negatives (log-scale trap),
empty, single point, a combined "kitchen sink", a run whose endpoint returns HTTP 500, and a live
run that keeps growing.

The generator also returns a ground-truth manifest of what it injected; tests check that
normalization rediscovers exactly those defects from the data alone.

## Data policies

Implemented in `src/core/normalize.ts`; reasoning in `docs/decisions.md` (D1–D4).

| Situation | Policy | Shown to the user |
|---|---|---|
| Unsorted steps | Sorted by step; ties broken by log order | number of order breaks |
| Duplicate steps | **Last write in log order wins** (resume-from-checkpoint semantics) | duplicate steps, overwritten rows, overwritten rows that contained NaN/Inf |
| NaN / ±Infinity value | **Kept.** Never 0, never interpolated, never smoothed over. Breaks the line, drawn as a marker | count per metric and kind |
| Non-finite step | Row dropped (nowhere to draw it) | count |
| Gap | spacing > **1.5 × median spacing** (of unique steps) → the line breaks | list of missing ranges |

## Repository layout

```
src/core/          pure TypeScript, no DOM/React: generator, normalization, downsampling (M4),
                   EMA, summary cards, axis ticks/labels — everything that decides truthfulness
src/worker/        the data worker: RunStore (generate → normalize → views), entry point
src/api/           mock API (latency, HTTP 500/404, ?latency= / ?fail=), worker RPC with abort
src/hooks/         useRequest — race-safe fetching (abort + latest-request check)
src/ui/            list page, run page, chart (uPlot as a renderer), cards, states, formatting
src/naive/         the naive baseline, kept at ?impl=naive for before/after measurements
tests/reference/   brute-force oracle implementations, used only by tests
e2e/               Playwright tests
scripts/           run-and-save.mjs (saves test output with command/commit/exit-code header)
results/           saved test output, as is, including failures
perf/              performance script, traces, before/after metrics (stage 3+)
docs/              brief, decision log, experiments, truthfulness claims and blind spots
```

## URL switches

| Parameter | Effect |
|---|---|
| `?latency=0`, `?latency=diverging:1500,*:100` | fixed or per-endpoint mock-API latency (default: random 100–1500 ms) |
| `?fail=plateau,list` | force HTTP 500 for those endpoints (`server-error` always fails) |
| `?fail=live@2` | fail from the 2nd request on (first load works, refreshes fail) |
| `?poll=10000`, `?stale=30000` | polling interval of the live run, and when its data counts as stale |
| `?locale=de-DE` | number formatting locale (default: the browser's) |
| `?impl=naive` | the naive baseline UI |
| `?perf` | enable performance marks/measures (used by `perf/run-perf.ts`) |

## Keyboard

List: <kbd>/</kbd> focuses the filter, <kbd>↓</kbd>/<kbd>↑</kbd> move between runs, <kbd>Enter</kbd>
opens one. Chart (focus it with <kbd>Tab</kbd>): <kbd>+</kbd>/<kbd>−</kbd> zoom, <kbd>←</kbd>/<kbd>→</kbd>
pan, <kbd>0</kbd> reset. Drag across a chart to zoom; double-click resets.
