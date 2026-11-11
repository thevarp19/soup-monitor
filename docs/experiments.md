# Checking the assumptions behind the measurements

Before measuring anything, four things the methodology depends on were checked, because each one
could make the "after" numbers look better than they are. Raw output:
`perf/experiments/verify-assumptions.txt` (script: `perf/experiments/verify-assumptions.ts`,
`pnpm perf:verify`). Google Chrome 157, headless, M1 Pro.

## 1. Does uPlot already downsample internally? — **Yes.**

`node_modules/uplot/dist/uPlot.esm.js`, `linear()` (lines ~2166–2236): when the visible range has
`≥ 4 × plot width` points, uPlot collapses each pixel column into one vertical min–max segment
(plus in/out values). Visually lossless — so the naive baseline (all 1M points to uPlot) is not
untruthful about the spike; the before/after difference is about main-thread work and memory.

Side finding: uPlot draws `null` gaps by **clipping** a rectangle from the pixel of the point before
the gap to the pixel of the point after it (`findGaps` / `clipGaps`). A spike drawn in the same or
an adjacent pixel column as a NaN could therefore be partly clipped away. Our data tests cannot see
this; it is a candidate for the pixel-level e2e check.

## 2. Does DevTools CPU throttling slow down Web Workers? — **No, and it cannot be enabled for them.**

Fixed work (3·10⁷ × `Math.sqrt`): main thread ×3.99 under `Emulation.setCPUThrottlingRate(4)`,
dedicated worker ×1.02. Sending the same command to the worker's own CDP target returns
`"Operation is only supported for pages, not workers"`.

Consequence: moving work into a worker would look ~4× faster *for the wrong reason*. The perf
script therefore reports, next to the measured first render, an adjusted value that adds
`(rate − 1) × worker busy time` — an upper bound for "as if the worker were throttled too".

## 3. Can hover be measured with the Event Timing API (INP-style)? — **No.**

With 60 ms busy handlers on `pointermove` and `mousemove`, Event Timing reported **no**
`pointermove`/`mousemove` entries at all (continuous events are excluded by design). Their cost only
leaked into `pointerenter`/`pointerover` entries (120 ms = 60 + 60) when the pointer *entered* the
element. So hover is measured by hand: `pointermove` timestamp → next paint (`src/perf/marks.ts`),
cross-checked with `EventDispatch(mousemove)` durations from the trace.

## 4. What do the memory metrics see? — **`JSHeapUsedSize` misses ArrayBuffers and workers.**

| 1M points × 4 fields | tab footprint | `JSHeapUsedSize` (CDP) | `performance.memory` | `measureUserAgentSpecificMemory` |
|---|---|---|---|---|
| empty page | 21 MB | 1.9 MB | 1.9 MB | 1.4 MB |
| main thread, 1M row objects | 94 MB | 66.7 MB | 66.7 MB | 66.3 MB |
| main thread, 4 × Float64Array | 55 MB | **1.9 MB** | 32.4 MB | 31.9 MB |
| worker, 4 × Float64Array | 55 MB | **1.9 MB** | **1.9 MB** | 31.9 MB (attributed to the worker) |

**Correction.** The first version of this table (and of the perf results) summed the footprint of
*all* renderer processes — three per run: the tab plus two others (~11 MB and ~24–27 MB, constant).
That was found when the author's manual Chrome Task Manager screenshot showed far less than the
script. The tab is now the renderer with the most CPU time; the others are still recorded. Only
the tab's process changes with the allocations above, which confirms the choice.

`JSHeapUsedSize` does not count typed-array backing stores at all; `performance.memory` does not
count workers. Comparing objects vs typed arrays in a worker with either of them would report a
fake ~97% saving. Before/after therefore uses the renderer process **footprint** (what Chrome Task
Manager shows as "Memory footprint") and `measureUserAgentSpecificMemory`; the other two are
recorded with a "main thread only" label.

(Numbers in this table are from one run of the script; see the raw output file for the exact run.)
