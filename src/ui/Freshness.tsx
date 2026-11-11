/**
 * "Is this data current?" A live run shows when it was last updated SUCCESSFULLY and is marked
 * Stale once that is older than the threshold — e.g. while refreshes keep failing. Without this,
 * a chart that stopped updating looks exactly like a run whose loss stopped changing.
 */
import { useNow } from '../hooks/useNow.ts';
import { formatAgo, formatTime, isStale } from './time.ts';

interface Props {
  lastSuccessAt: number | null;
  live: boolean;
  staleMs: number;
  error: unknown;
  locale: string;
  /** Only for tests; the UI uses the viewer's zone (and names it). */
  timeZone?: string;
}

export function Freshness({ lastSuccessAt, live, staleMs, error, locale, timeZone }: Props) {
  const now = useNow(1000);
  if (lastSuccessAt === null) return null;
  const stale = live && isStale(lastSuccessAt, now, staleMs);
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  return (
    <p className={`freshness${stale ? ' freshness-stale' : ''}`} data-testid="freshness" role="status">
      {stale && <strong className="badge-stale">Stale</strong>}{' '}
      {live ? 'Updated' : 'Loaded'} {formatTime(lastSuccessAt, locale, timeZone)}
      {live && ` · ${formatAgo(now - lastSuccessAt, locale)}`}
      {stale && ' — the chart may not show the latest steps.'}
      {message && live && <span className="freshness-error"> Last refresh failed: {message}</span>}
    </p>
  );
}
