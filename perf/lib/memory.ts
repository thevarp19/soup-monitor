/**
 * Memory probes used by the perf script and the assumption experiments.
 *
 * Several sources on purpose, because they measure different things (see decisions I1):
 *  - tabFootprintMB: macOS `footprint` of THE TAB'S renderer process — what Chrome Task Manager
 *    shows as the tab's memory; includes its Web Worker (same process) and ArrayBuffer backing
 *    stores. The tab's process is the renderer with the most CPU time (it does all the work).
 *    A first version summed ALL renderer processes (3 per run: the tab plus spare/utility
 *    renderers) — found when the author's manual Task Manager screenshot showed far less.
 *    All renderers are still recorded (`renderers`) for transparency.
 *  - uaSpecific: performance.measureUserAgentSpecificMemory() — JS memory incl. workers; needs
 *    cross-origin isolation.
 *  - jsHeapUsed (CDP Performance.getMetrics) and performance.memory — main-thread V8 heap only.
 */
import { execFileSync } from 'node:child_process';
import type { Browser, CDPSession, Page } from '@playwright/test';

export interface MemorySample {
  /** macOS footprint of the tab's renderer process (the one with the most CPU time), MB. */
  tabFootprintMB: number | null;
  tabPid: number | null;
  /** Every renderer process seen, for transparency. */
  renderers: Array<{ pid: number; cpuTimeS: number; footprintMB: number | null }>;
  /** CDP Performance.getMetrics → JSHeapUsedSize, MB. */
  jsHeapUsedMB: number;
  /** performance.memory.usedJSHeapSize, MB (precise only with --enable-precise-memory-info). */
  perfMemoryUsedMB: number | null;
  /** measureUserAgentSpecificMemory().bytes, MB; null if unavailable (not cross-origin isolated). */
  uaSpecificMB: number | null;
  uaSpecificBreakdown: Array<{ types: string[]; urls: string[]; MB: number }> | null;
}

const MB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

function footprintMB(pid: number): number | null {
  try {
    const out = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(out);
    if (!m) return null;
    const v = Number(m[1]);
    return Math.round((m[2] === 'KB' ? v / 1024 : m[2] === 'GB' ? v * 1024 : v) * 10) / 10;
  } catch {
    return null;
  }
}

/** Renderer processes with their CPU time (seconds). */
export async function renderers(browser: Browser): Promise<Array<{ pid: number; cpuTimeS: number }>> {
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = (await session.send('SystemInfo.getProcessInfo')) as {
    processInfo: Array<{ type: string; id: number; cpuTime: number }>;
  };
  await session.detach();
  return processInfo.filter((p) => p.type === 'renderer').map((p) => ({ pid: p.id, cpuTimeS: Math.round(p.cpuTime * 100) / 100 }));
}

export async function sampleMemory(browser: Browser, page: Page, cdp: CDPSession): Promise<MemorySample> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
  const jsHeapUsed = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? NaN;

  const inPage = await page.evaluate(async () => {
    const pm = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let ua: { bytes: number; breakdown: Array<{ bytes: number; types: string[]; attribution: Array<{ url: string }> }> } | null = null;
    const p = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<typeof ua> };
    if (self.crossOriginIsolated && p.measureUserAgentSpecificMemory) ua = await p.measureUserAgentSpecificMemory();
    return { perfMemory: pm?.usedJSHeapSize ?? null, ua };
  });

  const procs = (await renderers(browser)).map((r) => ({ ...r, footprintMB: footprintMB(r.pid) }));
  const tab = procs.reduce<(typeof procs)[number] | null>((best, r) => (best === null || r.cpuTimeS > best.cpuTimeS ? r : best), null);
  return {
    tabFootprintMB: tab?.footprintMB ?? null,
    tabPid: tab?.pid ?? null,
    renderers: procs,
    jsHeapUsedMB: MB(jsHeapUsed),
    perfMemoryUsedMB: inPage.perfMemory === null ? null : MB(inPage.perfMemory),
    uaSpecificMB: inPage.ua ? MB(inPage.ua.bytes) : null,
    uaSpecificBreakdown: inPage.ua
      ? inPage.ua.breakdown
          .filter((b) => b.bytes > 0)
          .map((b) => ({ types: b.types, urls: b.attribution.map((a) => a.url), MB: MB(b.bytes) }))
      : null,
  };
}
