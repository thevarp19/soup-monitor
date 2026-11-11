/**
 * Checks three assumptions the perf methodology depends on, in real Google Chrome:
 *
 *  A. Does DevTools CPU throttling (Emulation.setCPUThrottlingRate on the page) slow down a
 *     dedicated Web Worker? If not, moving work into a worker would look faster for the wrong reason.
 *  B. Does the Event Timing API (PerformanceObserver type "event") report pointermove/mousemove?
 *     The brief's "hover response" is a pointermove interaction.
 *  C. What do JSHeapUsedSize / performance.memory / measureUserAgentSpecificMemory / the process
 *     footprint see when 1M points are stored as objects, as Float64Arrays, or in a worker?
 *
 * usage: node perf/experiments/verify-assumptions.ts   (prints a report; run via run-and-save)
 */
import { chromium, type CDPSession } from '@playwright/test';
import { sampleMemory } from '../lib/memory.ts';

const ORIGIN = 'http://localhost:9871'; // never actually contacted: requests are fulfilled by page.route
const PAGE = /* html */ `<!doctype html><html><body>
<div id="pad" style="width:400px;height:400px;background:#ddd"></div>
<script>
const WORKER_SRC = \`
  let cols = null;
  onmessage = (e) => {
    if (e.data === 'work') {
      const t0 = performance.now(); let s = 0;
      for (let i = 0; i < 3e7; i++) s += Math.sqrt(i);
      postMessage({ ms: performance.now() - t0, s });
    } else if (e.data === 'alloc') {
      cols = [0, 1, 2, 3].map(() => { const a = new Float64Array(1e6); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; });
      postMessage({ ok: true });
    } else if (e.data === 'free') { cols = null; postMessage({ ok: true }); }
  };\`;
const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
const ask = (msg) => new Promise((r) => { worker.onmessage = (e) => r(e.data); worker.postMessage(msg); });
window.workInWorker = async () => (await ask('work')).ms;
window.workInMain = () => { const t0 = performance.now(); let s = 0; for (let i = 0; i < 3e7; i++) s += Math.sqrt(i); window.__s = s; return performance.now() - t0; };
window.allocWorker = () => ask('alloc');
window.freeWorker = () => ask('free');
window.allocObjects = () => { window.__rows = Array.from({ length: 1e6 }, (_, i) => ({ step: i, loss: Math.random(), lr: Math.random(), grad_norm: Math.random() })); };
window.allocTyped = () => { window.__cols = [0, 1, 2, 3].map(() => { const a = new Float64Array(1e6); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; }); };
window.freeMain = () => { window.__rows = null; window.__cols = null; };

const burn = (ms) => { const t = performance.now(); while (performance.now() - t < ms) {} };
window.__events = [];
new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__events.push({ name: e.name, duration: e.duration }); })
  .observe({ type: 'event', durationThreshold: 16, buffered: true });
const pad = document.getElementById('pad');
pad.addEventListener('pointermove', () => burn(60));
pad.addEventListener('mousemove', () => burn(60));
pad.addEventListener('pointerdown', () => burn(60)); // positive control: a discrete event
</script></body></html>`;

/** Apply Emulation.setCPUThrottlingRate to every dedicated-worker target via a browser CDP session. */
export async function throttleWorkers(browser: import('@playwright/test').Browser, rate: number): Promise<string> {
  const bs = await browser.newBrowserCDPSession();
  const { targetInfos } = (await bs.send('Target.getTargets')) as { targetInfos: Array<{ targetId: string; type: string }> };
  const workers = targetInfos.filter((t) => t.type === 'worker');
  const replies: string[] = [];
  for (const w of workers) {
    const { sessionId } = (await bs.send('Target.attachToTarget', { targetId: w.targetId, flatten: false })) as { sessionId: string };
    const reply = new Promise<string>((resolve) => {
      bs.on('Target.receivedMessageFromTarget', (e: { sessionId: string; message: string }) => {
        if (e.sessionId === sessionId && (JSON.parse(e.message) as { id?: number }).id === 1) resolve(e.message);
      });
    });
    await bs.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method: 'Emulation.setCPUThrottlingRate', params: { rate } }),
    });
    replies.push(await reply);
    await bs.send('Target.detachFromTarget', { sessionId });
  }
  await bs.detach();
  return `${workers.length} worker target(s): ${replies.join(' ')}`;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
  console.log(`browser: Google Chrome ${browser.version()} (headless), Playwright CDP`);
  const context = await browser.newContext();
  await context.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
      body: PAGE,
    }),
  );
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  console.log(`crossOriginIsolated: ${await page.evaluate(() => self.crossOriginIsolated)}`);

  // ---------------------------------------------------------------------------- A
  console.log('\n== A. CPU throttling ×4 and Web Workers (fixed work: 3e7 × Math.sqrt, median of 3) ==');
  const measure = async () => {
    const main: number[] = [];
    const worker: number[] = [];
    for (let i = 0; i < 3; i++) {
      main.push(await page.evaluate(() => (window as unknown as { workInMain: () => number }).workInMain()));
      worker.push(await page.evaluate(() => (window as unknown as { workInWorker: () => Promise<number> }).workInWorker()));
    }
    return { main: median(main), worker: median(worker) };
  };
  const off = await measure();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const on = await measure();
  const workerThrottle = await throttleWorkers(browser, 4);
  const both = await measure();
  await throttleWorkers(browser, 1);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const r = (x: number) => x.toFixed(0).padStart(5);
  console.log(`              no throttling   page throttled ×4   page + worker targets throttled ×4`);
  console.log(`main thread   ${r(off.main)} ms        ${r(on.main)} ms (×${(on.main / off.main).toFixed(2)})   ${r(both.main)} ms (×${(both.main / off.main).toFixed(2)})`);
  console.log(`web worker    ${r(off.worker)} ms        ${r(on.worker)} ms (×${(on.worker / off.worker).toFixed(2)})   ${r(both.worker)} ms (×${(both.worker / off.worker).toFixed(2)})`);
  console.log(`worker-target CDP response: ${workerThrottle}`);

  // ---------------------------------------------------------------------------- B
  console.log('\n== B. Event Timing API: which events are reported (handlers busy-wait 60 ms) ==');
  const box = await page.locator('#pad').boundingBox();
  if (!box) throw new Error('no pad');
  for (let i = 0; i < 6; i++) await page.mouse.move(box.x + 50 + i * 50, box.y + 200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const events = await page.evaluate(() => (window as unknown as { __events: Array<{ name: string; duration: number }> }).__events);
  const byName = new Map<string, number[]>();
  for (const e of events) byName.set(e.name, [...(byName.get(e.name) ?? []), Math.round(e.duration)]);
  for (const name of ['pointermove', 'mousemove', 'pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    const d = byName.get(name);
    console.log(`${name.padEnd(13)} ${d ? `reported ×${d.length}, durations ${d.join(', ')} ms` : 'NOT reported'}`);
  }
  for (const [name, d] of byName) if (!['pointermove', 'mousemove', 'pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'].includes(name)) console.log(`${name.padEnd(13)} reported ×${d.length}`);

  // ---------------------------------------------------------------------------- C
  console.log('\n== C. What each memory metric sees (1M points × 4 fields) ==');
  type Win = { allocObjects(): void; allocTyped(): void; freeMain(): void; allocWorker(): Promise<unknown>; freeWorker(): Promise<unknown> };
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['baseline (empty page)', async () => {}],
    ['main: 1M objects {step,loss,lr,grad_norm}', () => page.evaluate(() => (window as unknown as Win).allocObjects())],
    ['main: 4 × Float64Array(1M) (objects freed)', () => page.evaluate(() => { (window as unknown as Win).freeMain(); (window as unknown as Win).allocTyped(); })],
    ['worker: 4 × Float64Array(1M) (main freed)', async () => { await page.evaluate(() => (window as unknown as Win).freeMain()); await page.evaluate(() => (window as unknown as Win).allocWorker()); }],
  ];
  console.log('step'.padEnd(46) + 'tab footprint  JSHeapUsed  perf.memory  uaSpecific   (other renderers)');
  for (const [label, act] of steps) {
    await act();
    const m = await sampleMemory(browser, page, cdp);
    const f = (v: number | null) => (v === null ? 'n/a' : `${v} MB`).padStart(9);
    const others = m.renderers.filter((r) => r.pid !== m.tabPid).map((r) => `${r.footprintMB} MB/${r.cpuTimeS}s`).join(', ');
    console.log(`${label.padEnd(46)}${f(m.tabFootprintMB)}     ${f(m.jsHeapUsedMB)}  ${f(m.perfMemoryUsedMB)}   ${f(m.uaSpecificMB)}   (${others})`);
    if (m.uaSpecificBreakdown) for (const b of m.uaSpecificBreakdown) console.log(`${''.padEnd(48)}uaSpecific breakdown: ${b.MB} MB ${b.types.join('/') || '(no type)'} ${b.urls.join(' ') || ''}`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
