/**
 * Performance measurements for the 1M-point run, in Google Chrome with CPU throttling ×4.
 *
 * usage: node perf/run-perf.ts --label before|after [--impl naive] [--runs 5]
 *
 * For each of N runs (fresh browser context each time, no tracing):
 *   1. navigate to /runs/long-1m?latency=0&perf → "first render" = startTime of the
 *      `chart:first-draw` mark (time since navigation start); long tasks until then (TBT);
 *   2. memory after GC (renderer footprint, measureUserAgentSpecificMemory, JSHeapUsedSize,
 *      performance.memory — see perf/lib/memory.ts for why there are four);
 *   3. hover: 20 pointer moves across the loss chart → `hover` measures (event → next paint);
 *   4. zoom: drag-select 40%→60% of the loss chart → `zoom` measure (mouseup → next paint after the
 *      new range is drawn).
 * Then ONE extra run with a Chrome trace (perf/trace-<label>.json, open in DevTools → Performance);
 * the trace is not used for the numbers because tracing itself adds overhead.
 *
 * Caveat measured in perf/experiments: CPU throttling does not apply to Web Workers, and Chrome
 * refuses to throttle worker targets. Pages that use a worker report `window.__perf.workerMs`
 * (worker busy time before first draw); the script then also reports an "adjusted" first render
 * that adds (rate − 1) × that time — an upper bound for "as if the worker were throttled too".
 */
import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { chromium, type Browser, type Page } from '@playwright/test';
import { sampleMemory, type MemorySample } from './lib/memory.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LABEL = opt('label', 'adhoc');
const IMPL = opt('impl', '');
const RUNS = Number(opt('runs', '5'));
const RATE = 4;
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1280, height: 900 };
const DPR = 2;
const FIRST_DRAW_TIMEOUT_MS = 180_000;
const URL_PATH = `/runs/long-1m?latency=0&perf${IMPL ? `&impl=${IMPL}` : ''}`;

interface Iteration {
  firstRenderMs: number | null;
  marks: Record<string, number>;
  tbtMs: number | null;
  longTasks: number | null;
  workerMs: number | null;
  firstRenderAdjustedMs: number | null;
  memory: MemorySample | null;
  hoverMs: number[];
  zoomMs: number | null;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(page: Page, fn: () => T | null, timeoutMs: number): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v !== null && v !== undefined) return v as T;
    await sleep(250);
  }
  return null;
}

/** Collect long tasks from the very start of the page. */
const INIT_SCRIPT = () => {
  const w = window as unknown as { __longtasks: Array<{ start: number; duration: number }> };
  w.__longtasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__longtasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
};

async function chartBox(page: Page) {
  const box = await page.locator('[data-chart="loss"] .u-over').boundingBox();
  if (!box) throw new Error('loss chart not found');
  return box;
}

async function scenario(browser: Browser, page: Page, withMemory: boolean): Promise<Iteration> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });

  const it: Iteration = { firstRenderMs: null, marks: {}, tbtMs: null, longTasks: null, workerMs: null, firstRenderAdjustedMs: null, memory: null, hoverMs: [], zoomMs: null };
  await page.goto(BASE + URL_PATH, { waitUntil: 'load', timeout: FIRST_DRAW_TIMEOUT_MS });
  const firstDraw = await waitFor(page, () => performance.getEntriesByName('chart:first-draw', 'mark')[0]?.startTime ?? null, FIRST_DRAW_TIMEOUT_MS);
  if (firstDraw === null) {
    it.error = `no chart:first-draw within ${FIRST_DRAW_TIMEOUT_MS / 1000}s`;
    return it;
  }
  it.firstRenderMs = Math.round(firstDraw);
  const info = await page.evaluate((fd) => {
    const marks: Record<string, number> = {};
    for (const m of performance.getEntriesByType('mark')) marks[m.name] = Math.round(m.startTime);
    const lts = (window as unknown as { __longtasks: Array<{ start: number; duration: number }> }).__longtasks.filter((l) => l.start < fd);
    const workerMs = (window as unknown as { __perf?: { workerMs?: number } }).__perf?.workerMs ?? null;
    return { marks, tbt: lts.reduce((s, l) => s + Math.max(0, l.duration - 50), 0), count: lts.length, workerMs };
  }, firstDraw);
  it.marks = info.marks;
  it.tbtMs = Math.round(info.tbt);
  it.longTasks = info.count;
  it.workerMs = info.workerMs === null ? null : Math.round(info.workerMs);
  it.firstRenderAdjustedMs = info.workerMs === null ? it.firstRenderMs : Math.round(firstDraw + (RATE - 1) * info.workerMs);

  await sleep(1000);
  if (withMemory) it.memory = await sampleMemory(browser, page, cdp);

  // hover: 20 moves across the middle of the loss chart, ~80 ms apart
  const box = await chartBox(page);
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(box.x + box.width * (0.1 + 0.04 * i), box.y + box.height * 0.5);
    await sleep(80);
  }
  await sleep(500);
  it.hoverMs = await page.evaluate(() => performance.getEntriesByName('hover', 'measure').map((m) => Math.round(m.duration * 10) / 10));

  // zoom: drag-select 40% → 60%
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await page.mouse.up();
  const zoom = await waitFor(page, () => performance.getEntriesByName('zoom', 'measure')[0]?.duration ?? null, 60_000);
  it.zoomMs = zoom === null ? null : Math.round(zoom);
  await cdp.detach();
  return it;
}

function stats(values: Array<number | null>) {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { median: Math.round(median * 10) / 10, min: v[0], max: v[v.length - 1], n: v.length, values };
}

function traceEventDispatch(tracePath: string) {
  // Cross-check for hover/zoom from the trace: durations of mousemove/mouseup dispatch on the main thread.
  const trace = JSON.parse(execSync(`cat ${tracePath}`, { maxBuffer: 2 ** 31 }).toString()) as { traceEvents: Array<{ name: string; dur?: number; args?: { data?: { type?: string } } }> };
  const out: Record<string, number[]> = {};
  for (const e of trace.traceEvents) {
    if (e.name !== 'EventDispatch' || e.dur === undefined) continue;
    const type = e.args?.data?.type ?? '?';
    if (!['mousemove', 'pointermove', 'mouseup', 'mousedown'].includes(type)) continue;
    (out[type] ??= []).push(Math.round(e.dur / 100) / 10);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stats(v)]));
}

async function main() {
  const commit = execSync('git rev-parse --short HEAD').toString().trim();
  const dirty = execSync("git status --porcelain -- . ':(exclude)perf' ':(exclude)results'").toString().trim() !== '';
  console.log(`perf "${LABEL}" — commit ${commit}${dirty ? ' (dirty)' : ''}, ${URL_PATH}, ${RUNS} runs, CPU ×${RATE}`);

  execSync('pnpm build', { stdio: 'inherit' });
  const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stop);
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE);
      break;
    } catch {
      await sleep(200);
    }
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
  const chromeVersion = browser.version();
  const iterations: Iteration[] = [];
  try {
    for (let r = 0; r < RUNS; r++) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
      await context.addInitScript(INIT_SCRIPT);
      const page = await context.newPage();
      let it: Iteration;
      try {
        it = await scenario(browser, page, true);
      } catch (e) {
        it = { firstRenderMs: null, marks: {}, tbtMs: null, longTasks: null, workerMs: null, firstRenderAdjustedMs: null, memory: null, hoverMs: [], zoomMs: null, error: String(e) };
      }
      iterations.push(it);
      console.log(`run ${r + 1}: first render ${it.firstRenderMs} ms (TBT ${it.tbtMs} ms), hover median ${stats(it.hoverMs)?.median} ms, zoom ${it.zoomMs} ms, footprint ${it.memory?.rendererFootprintMB} MB${it.error ? `, ERROR ${it.error}` : ''}`);
      await context.close();
    }

    // one traced run (numbers not used — tracing adds overhead)
    const tracePath = `perf/trace-${LABEL}.json`;
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    await browser.startTracing(page, { path: tracePath, screenshots: true });
    let tracedError: string | undefined;
    try {
      await scenario(browser, page, false);
    } catch (e) {
      tracedError = String(e);
    }
    await browser.stopTracing();
    await context.close();
    const dispatch = traceEventDispatch(tracePath);

    const median = (f: (m: MemorySample) => number | null) => stats(iterations.map((i) => (i.memory ? f(i.memory) : null)));
    const result = {
      label: LABEL,
      impl: IMPL || 'default',
      url: URL_PATH,
      date: new Date().toISOString(),
      commit: commit + (dirty ? ' (dirty)' : ''),
      environment: { chrome: chromeVersion, headless: true, node: process.version, machine: `${os.cpus()[0]?.model} · ${Math.round(os.totalmem() / 2 ** 30)} GB · ${os.platform()} ${os.release()}` },
      settings: { cpuThrottlingRate: RATE, runs: RUNS, viewport: VIEWPORT, deviceScaleFactor: DPR, firstDrawTimeoutMs: FIRST_DRAW_TIMEOUT_MS },
      summary: {
        firstRenderMs: stats(iterations.map((i) => i.firstRenderMs)),
        firstRenderAdjustedForUnthrottledWorkerMs: stats(iterations.map((i) => i.firstRenderAdjustedMs)),
        totalBlockingTimeBeforeFirstRenderMs: stats(iterations.map((i) => i.tbtMs)),
        hoverMs_medianPerRun: stats(iterations.map((i) => stats(i.hoverMs)?.median ?? null)),
        hoverMs_maxPerRun: stats(iterations.map((i) => stats(i.hoverMs)?.max ?? null)),
        zoomMs: stats(iterations.map((i) => i.zoomMs)),
        memory: {
          rendererFootprintMB: median((m) => m.rendererFootprintMB),
          uaSpecificMB: median((m) => m.uaSpecificMB),
          jsHeapUsedMB_mainThreadOnly: median((m) => m.jsHeapUsedMB),
          performanceMemoryMB_mainThreadOnly: median((m) => m.perfMemoryUsedMB),
        },
        traceEventDispatchMs: dispatch,
      },
      trace: { path: tracePath, error: tracedError ?? null },
      iterations,
    };
    const out = `perf/results-${LABEL}.json`;
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(`\nwritten ${out} and ${tracePath}`);
    console.log(JSON.stringify(result.summary, (k, v) => (k === 'values' ? undefined : v), 2));
  } finally {
    await browser.close();
    stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
