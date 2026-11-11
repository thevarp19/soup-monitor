/**
 * NAIVE BASELINE run page. Known problems, kept on purpose and fixed in the real UI:
 *  - generation, row objects and conversion all run on the main thread;
 *  - every point goes to the chart;
 *  - NaN/±Inf are silently turned into gaps (no markers, no counts);
 *  - duplicates are not resolved (sorted only);
 *  - no AbortController / request id: switching runs quickly can show the wrong run (race).
 */
import { useEffect, useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { Link } from '../router.ts';
import { markOnce } from '../perf/marks.ts';
import { NaiveChart, type ChartGroup } from './NaiveChart.tsx';
import { naiveFetchRun, type NaiveRow } from './naiveApi.ts';

function toUPlot(rows: NaiveRow[]) {
  const sorted = [...rows].sort((a, b) => a.step - b.step);
  const x = sorted.map((r) => r.step);
  const col = (k: 'loss' | 'lr' | 'grad_norm') => sorted.map((r) => (Number.isFinite(r[k]) ? r[k] : null));
  const out = {
    loss: [x, col('loss')] as uPlot.AlignedData,
    lr: [x, col('lr')] as uPlot.AlignedData,
    grad_norm: [x, col('grad_norm')] as uPlot.AlignedData,
  };
  markOnce('data:prepared');
  return out;
}

export function NaiveRunPage({ id }: { id: string }) {
  const [rows, setRows] = useState<NaiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const group = useMemo<ChartGroup>(() => new Set(), []);

  useEffect(() => {
    // Naive on purpose (this is the baseline the real UI is compared against).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    setError(null);
    naiveFetchRun(id).then(setRows, (e: unknown) => setError(String(e)));
  }, [id]);

  const data = useMemo(() => (rows ? toUPlot(rows) : null), [rows]);

  useEffect(() => {
    document.title = `[naive] ${id} · Soup run monitor`;
  }, [id]);

  return (
    <main className="naive">
      <p>
        <Link to={`/?impl=naive${window.location.search.includes('perf') ? '&perf' : ''}`}>← all runs</Link> · naive baseline
      </p>
      <h1>{id}</h1>
      {error && <p role="alert">Error: {error}</p>}
      {!error && !data && <p>Loading…</p>}
      {data && (
        <>
          <p>{rows?.length.toLocaleString()} points</p>
          <NaiveChart title="loss" data={data.loss} color="#1f6feb" group={group} firstDrawMark />
          <NaiveChart title="lr" data={data.lr} color="#8250df" group={group} />
          <NaiveChart title="grad_norm" data={data.grad_norm} color="#bf3989" group={group} />
        </>
      )}
    </main>
  );
}
