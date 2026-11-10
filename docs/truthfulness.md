# Is the chart truthful? Claims, proofs and blind spots

Pipeline: raw rows (log order) → `normalize` → (`ema`) → `downsample(range, device-pixel width)` →
chart. Cards: `summarize`. Axes: `visibleExtent` → `linearTicks` / `logTicks` / `xTicks`.
Everything above is pure TypeScript in `src/core/` and tested without a browser.
Test output: `results/test-output.txt`. Mutation check: `results/mutation-output.txt`.

## What is proven, and by which test

| Brief's claim | What the tests assert | Where |
|---|---|---|
| **The spike is visible at every zoom level** | On the 1M run, the max of the data handed to the chart **equals the spike value** for 9 windows (full, 1/10, 1/100, 1/1000, ±10 steps, spike on the left/right edge) × 3 widths (320, 800, 1920 px), and the spike is drawn at step 500,000. In 4 windows that exclude it, the spike is **absent** and the max equals the brute-force raw max of that window. Property (1000 random series/ranges/widths): per pixel column, min and max of the drawn points equal min and max of the raw drawable values. | `downsample.test.ts` |
| **NaN isn't drawn as 0** | NaN/±Inf are kept by normalization; downsampling emits a `null` (line break) at their step and a marker with kind and count. Property: every drawn point is a real raw `(step, value)` pair (`Object.is`), so a NaN can never come out as a number; no drawn segment crosses a NaN/Inf; marker counts equal brute force. | `normalize.test.ts`, `downsample.test.ts` |
| **…or silently smoothed** | EMA leaves NaN at the same index (not filled), skips it in the accumulator (values after a NaN equal the EMA of the series without it), and never turns ±Inf into a poisoned tail. Property: EMA output is non-finite exactly where the input is. The smoothed line breaks across gaps too. | `ema.test.ts` |
| **Duplicates and unsorted steps don't distort the line** | Normalization equals an independent oracle on 500 random inputs (duplicates, NaN, invalid steps, any order); shuffling rows with unique steps gives the identical series; for `duplicate-steps`, `unsorted-steps` and `kitchen-sink` the drawn line at full resolution equals the oracle's last-write series point for point; shuffling rows does not change the drawing. | `normalize.test.ts`, `downsample.test.ts` |
| **Gaps** | A spacing > 1.5 × median breaks the line (`null` half-way across the hole); exactly 1.5 × is not a gap; duplicates do not shrink the median. Normalization rediscovers exactly the gaps the generator injected in all 20 runs. | `normalize.test.ts`, `downsample.test.ts` |
| **Numbers match the data** | Card values (`lastLoss`, `lastFiniteLoss`, `minLoss`, `currentLr`, `maxGradNorm`, NaN/Inf/duplicate/gap counts) equal a brute-force computation over the raw data for all 20 runs. The last loss of `nan-single` is reported as NaN (not the previous finite value). | `summary.test.ts` |
| **Axis labels match the data** | For zoom windows on the 1M run, the y-axis range covers the brute-force min and max of the raw data in the window (incl. the spike in the last pixel column). Property (1000 random extents): ticks are increasing, cover the data, every label **parses back to exactly the tick value**, and no two labels are equal (no "0.0003, 0.0003"). Same for log ticks (500) and integer step ticks. | `scale.test.ts` |
| **Log scale with zeros** | On a log scale, values ≤ 0 are never drawn: they break the line and appear as `nonpositive` markers with counts; `logTicks` refuses a non-positive minimum instead of producing −∞. | `downsample.test.ts`, `scale.test.ts` |
| **The tests can actually fail** | 22 realistic bugs injected one at a time (first-write-wins, NaN → 0, naive every-2nd-point decimation, min/max without first/last, gaps not breaking, EMA filling NaN, "last loss" = last finite, axis not covering data, labels one digit short, …): **all 22 caught**. | `scripts/mutation-check.mjs` |

Bugs these tests found in my own code while writing it (all fixed, each with a regression test):
`linearTicks` looped forever on subnormal values (5e-324 · 0.1 underflows to 0, log10(0) = −∞);
`linearTicks` returned NaN ticks for a range straddling 0 with a 2-tick budget; `xTicks` returned
no ticks for a narrow window with no multiple of the chosen step.

## What the tests would NOT catch

1. **Pixels.** We test the arrays handed to the chart library, not what it paints. uPlot could
   still drop, simplify or misplace them, and our pixel columns are computed with our formula while
   uPlot rounds value→pixel its own way, so "pixel-identical to drawing every point" holds only up
   to column boundaries (the min/max guarantee does not depend on it). *Partially closed in stage
   4: an e2e test reads the canvas with `getImageData` around the spike.*
2. **The wiring.** That the UI passes the right range, the width in *device* pixels, recomputes on
   zoom and on resize, and shows the markers. *e2e in stage 4.*
3. **Human perception.** That a 1-px spike or a small NaN marker is actually noticed; marker and
   line contrast on canvas (axe does not inspect canvas pixels).
4. **Browsers, GPUs, HiDPI, canvas size limits.**
5. **Shared misunderstandings.** The generator, its ground-truth manifest, the oracles and the
   implementation were written by the same author (with the same AI). Differential tests catch
   disagreement, not a wrong idea held by both (e.g. if "resume from checkpoint" really meant
   something else). Hand-computed literal tests reduce this, they don't remove it.
6. **Data the generator does not produce:** irregular logging intervals, metrics logged at
   different steps, steps above 2^53, a NaN in every other point of a 1M series (correct, but the
   output then grows with the number of breaks rather than with the width).
7. **Whether the policies are right.** Tests prove last-write-wins, the 1.5 × gap rule and
   "finite-only statistics" are implemented, not that they are the right choice for every team.
8. **Values below 1e-200** (subnormals): only "no hang" is guaranteed, not exact labels.
9. **Rare random cases.** Property tests run 300–1000 random cases per run; a rare failure may show
   up only on some runs (fast-check prints the seed to reproduce it).
10. **Unimagined bugs.** The mutation check covers the 22 bugs we thought of; it is not an
    exhaustive mutation-testing tool.
11. **Performance.** Correct but too slow is not caught here (stage 3).
