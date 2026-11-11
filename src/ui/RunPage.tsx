import { useCallback, useEffect, useId, useState } from 'react';
import { fetchRun } from '../api/mockApi.ts';
import type { Metric } from '../core/types.ts';
import { useRequest } from '../hooks/useRequest.ts';
import { zoomStarted } from '../perf/marks.ts';
import { Link } from '../router.ts';
import { Chart } from './Chart.tsx';
import { formatStep } from './format.ts';
import { QualityPanel } from './QualityPanel.tsx';
import { SummaryCards } from './SummaryCards.tsx';
import { EmptyState, ErrorState, Skeleton } from './states.tsx';
import { isFullRange, type Range } from './zoom.ts';

const CHARTS: Array<{ metric: Metric; title: string }> = [
  { metric: 'loss', title: 'loss' },
  { metric: 'lr', title: 'lr' },
  { metric: 'grad_norm', title: 'grad_norm' },
];
const EMA_WEIGHTS = [0.6, 0.9, 0.99, 0.999];

const fetcher = (id: string, signal: AbortSignal) => fetchRun(id, { signal });

export function RunPage({ id, locale, listSearch }: { id: string; locale: string; listSearch: string }) {
  const run = useRequest(id, fetcher);
  const hintId = useId();
  // Zoom range belongs to a run: a range chosen on run A is never applied to run B.
  const [zoom, setZoom] = useState<{ runId: string; range: Range } | null>(null);
  const [log, setLog] = useState(false);
  const [emaWeight, setEmaWeight] = useState<number | null>(null);

  const data = run.data;
  const full: Range | null = data && data.firstStep !== null && data.lastStep !== null ? { x0: data.firstStep, x1: data.lastStep } : null;
  const range = zoom && zoom.runId === id ? zoom.range : full;

  useEffect(() => {
    document.title = `${data ? data.name : id} · Soup run monitor`;
  }, [data, id]);

  const onRange = useCallback(
    (r: Range, eventTime: number) => {
      zoomStarted(eventTime);
      setZoom({ runId: id, range: r });
    },
    [id],
  );

  return (
    <main className="page run-page">
      <nav className="crumbs">
        <Link to={`/${listSearch}`}>← All runs</Link>
      </nav>
      <header className="run-header">
        <h1>{data ? data.name : id}</h1>
        {data && <span className={`status status-${data.status}`}>{data.status}</span>}
        {data && <p className="run-desc">{data.description}</p>}
      </header>

      {run.status === 'error' && <ErrorState title="Could not load this run" error={run.error} onRetry={run.retry} />}
      {run.status === 'loading' && !data && (
        <>
          <Skeleton label="Loading run summary…" lines={2} className="skeleton-cards" />
          <Skeleton label="Loading charts…" lines={6} className="skeleton-charts" />
        </>
      )}

      {data && run.status !== 'error' && (
        <>
          <SummaryCards summary={data.summary} locale={locale} />
          <QualityPanel quality={data.quality} locale={locale} />
          {!full || !range ? (
            <EmptyState title="No points logged yet">
              <p>This run has not reported any metrics. Charts appear once the first step is logged.</p>
            </EmptyState>
          ) : (
            <section aria-label="Charts" className="charts">
              <div className="controls">
                <label>
                  <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale (y)
                </label>
                <label>
                  Smoothing (EMA){' '}
                  <select value={emaWeight ?? 'off'} onChange={(e) => setEmaWeight(e.target.value === 'off' ? null : Number(e.target.value))}>
                    <option value="off">off</option>
                    {EMA_WEIGHTS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={(e) => onRange(full, e.timeStamp)} disabled={isFullRange(range, full)}>
                  Reset zoom
                </button>
                <span className="range-label">
                  Steps {formatStep(range.x0, locale)}–{formatStep(range.x1, locale)}
                </span>
              </div>
              <p id={hintId} className="hint">
                Drag across a chart to zoom. Keyboard: focus a chart, then <kbd>+</kbd>/<kbd>−</kbd> zoom, <kbd>←</kbd>/<kbd>→</kbd> pan, <kbd>0</kbd> reset.
              </p>
              {CHARTS.map((c, i) => (
                <Chart
                  key={`${id}:${c.metric}`}
                  runId={id}
                  metric={c.metric}
                  title={c.title}
                  range={range}
                  full={full}
                  onRange={onRange}
                  log={log}
                  emaWeight={emaWeight}
                  locale={locale}
                  syncKey={`run:${id}`}
                  hintId={hintId}
                  firstDrawMark={i === 0}
                />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
