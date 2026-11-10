# Soup — training run monitor

A training-run monitor built to answer one question: *can you show this chart to someone deciding
whether to stop a $500 run?* The focus is on the chart being **truthful**, not just looking right.

> Work in progress — see `docs/decisions.md` for every decision and its alternatives, and
> `docs/truthfulness.md` for what the tests prove about the chart and what they cannot catch.
> Deployed link: _TBD (stage 6)_.

## Run it

```bash
pnpm install
pnpm dev                # http://localhost:5173
pnpm test               # unit + property tests (Vitest + fast-check)
pnpm test:e2e           # Playwright (builds and serves the app on :4173)
pnpm test:save          # unit tests, output saved to results/test-output.txt
pnpm test:e2e:save      # e2e tests, output saved to results/e2e-output.txt
pnpm test:mutation      # inject 22 known bugs one by one, check the tests catch each one
pnpm typecheck && pnpm lint
```

First Playwright run: `pnpm exec playwright install chromium`.

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
tests/reference/   brute-force oracle implementations, used only by tests
e2e/               Playwright tests
scripts/           run-and-save.mjs (saves test output with command/commit/exit-code header)
results/           saved test output, as is, including failures
perf/              performance script, traces, before/after metrics (stage 3+)
docs/              brief and decision log
```
