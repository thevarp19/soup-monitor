/**
 * Times in the UI always carry their zone ("15:10:21 GMT+5"), formatted with an explicit locale.
 * The silent failure this prevents: `new Date(t).toLocaleTimeString()` silently depends on the
 * machine's locale AND time zone, and an unlabelled "15:10" means different moments to a reader in
 * Almaty and one in Los Angeles. Relative ages ("12 seconds ago") do not depend on the zone at all.
 */
const timeFormats = new Map<string, Intl.DateTimeFormat>();

export function formatTime(t: number, locale: string, timeZone?: string): string {
  const key = `${locale}|${timeZone ?? ''}`;
  let f = timeFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', timeZone });
    timeFormats.set(key, f);
  }
  return f.format(t);
}

export function formatAgo(ms: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? rtf.format(-s, 'second') : rtf.format(-Math.round(s / 60), 'minute');
}

/** Stale = more than `staleMs` since the last SUCCESSFUL update. Never loaded is "loading", not stale. */
export function isStale(lastSuccessAt: number | null, now: number, staleMs: number): boolean {
  return lastSuccessAt !== null && now - lastSuccessAt > staleMs;
}
