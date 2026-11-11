/**
 * Switches for demonstrating/testing the mock API, read from the page URL:
 *   ?latency=500                      fixed latency for every request
 *   ?latency=diverging:1500,*:100     per-endpoint latency ("list" = the run list), * = default
 *   ?fail=plateau,list                force HTTP 500 for those endpoints
 *   ?fail=live@2                      … only from the 2nd request on (first load works, refreshes fail)
 *   ?poll=10000  ?stale=30000         polling interval of a live run, and when its data counts as stale
 * Without them: random latency 100–1500 ms, so a request race can happen naturally.
 */
export interface ApiOptions {
  latencyFor(endpoint: string, random: () => number): number;
  /** `nth` = 1-based count of requests to this endpoint, this one included. */
  fails(endpoint: string, nth?: number): boolean;
  pollMs: number;
  staleMs: number;
}

const validMs = (s: string | undefined) => (s !== undefined && /^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : null);

export function parseApiOptions(search: string): ApiOptions {
  const p = new URLSearchParams(search);
  const perEndpoint = new Map<string, number>();
  let fixed: number | null = null;
  for (const part of (p.get('latency') ?? '').split(',')) {
    if (!part) continue;
    const colon = part.lastIndexOf(':');
    if (colon === -1) {
      fixed = validMs(part) ?? fixed;
      continue;
    }
    const ms = validMs(part.slice(colon + 1));
    if (ms !== null) perEndpoint.set(part.slice(0, colon), ms);
  }
  const failFrom = new Map<string, number>();
  for (const part of (p.get('fail') ?? '').split(',').filter(Boolean)) {
    const [name, from] = part.split('@');
    failFrom.set(name, from !== undefined && /^\d+$/.test(from) ? Number(from) : 1);
  }
  const positive = (key: string, fallback: number) => {
    const v = validMs(p.get(key) ?? undefined);
    return v !== null && v > 0 ? v : fallback;
  };
  return {
    latencyFor: (endpoint, random) => perEndpoint.get(endpoint) ?? perEndpoint.get('*') ?? fixed ?? 100 + random() * 1400,
    fails: (endpoint, nth = 1) => {
      const from = failFrom.get(endpoint);
      return from !== undefined && nth >= from;
    },
    pollMs: positive('poll', 10_000),
    staleMs: positive('stale', 30_000),
  };
}
