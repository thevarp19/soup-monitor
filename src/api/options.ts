/**
 * Switches for demonstrating/testing the mock API, read from the page URL:
 *   ?latency=500                      fixed latency for every request
 *   ?latency=diverging:1500,*:100     per-endpoint latency ("list" = the run list), * = default
 *   ?fail=plateau,list                force HTTP 500 for those endpoints
 * Without them: random latency 100–1500 ms, so a request race can happen naturally.
 */
export interface ApiOptions {
  latencyFor(endpoint: string, random: () => number): number;
  fails(endpoint: string): boolean;
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
  const failing = new Set((p.get('fail') ?? '').split(',').filter(Boolean));
  return {
    latencyFor: (endpoint, random) => perEndpoint.get(endpoint) ?? perEndpoint.get('*') ?? fixed ?? 100 + random() * 1400,
    fails: (endpoint) => failing.has(endpoint),
  };
}
