import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { fetchRuns } from '../api/mockApi.ts';
import { useRequest } from '../hooks/useRequest.ts';
import { Link, navigate } from '../router.ts';
import type { RunListItem } from '../worker/store.ts';
import { formatCount, formatValue } from './format.ts';
import { filterRuns, parseListState, serializeListState, sortRuns, type ListItem, type ListState, type SortKey } from './listModel.ts';
import { EmptyState, ErrorState, Skeleton } from './states.tsx';

const fetcher = (_key: string, signal: AbortSignal) => fetchRuns({ signal });

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean; narrowHidden?: boolean }> = [
  { key: 'name', label: 'Run' },
  { key: 'status', label: 'Status' },
  { key: 'lastLoss', label: 'Last loss', numeric: true },
  { key: 'minLoss', label: 'Min loss', numeric: true, narrowHidden: true },
  { key: 'points', label: 'Steps logged', numeric: true, narrowHidden: true },
  { key: 'issues', label: 'Data issues', numeric: true },
];

type Row = ListItem & { item: RunListItem };

export function RunListPage({ search, locale }: { search: string; locale: string }) {
  const runs = useRequest('list', fetcher);
  const state = useMemo(() => parseListState(search), [search]);
  const filterRef = useRef<HTMLInputElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    document.title = 'Training runs · Soup run monitor';
  }, []);

  const update = (patch: Partial<ListState>) => navigate(`/${serializeListState({ ...state, ...patch })}`, { replace: true });

  // "/" focuses the filter from anywhere on the page (unless the user is typing in a field).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      filterRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows: Row[] = useMemo(() => {
    const items: Row[] = (runs.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      points: r.points,
      lastLoss: r.summary.lastLoss?.value ?? null,
      minLoss: r.summary.minLoss?.value ?? null,
      issueCount: r.issueCount,
      item: r,
    }));
    return sortRuns(filterRuns(items, state), state.sort, state.dir);
  }, [runs.data, state]);

  // Arrow keys move between rows (focus stays on the row links; Enter opens the run).
  const onTableKey = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = Array.from(tbodyRef.current?.querySelectorAll<HTMLAnchorElement>('a.run-link') ?? []);
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i === -1) return;
    e.preventDefault();
    links[Math.min(links.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      tbodyRef.current?.querySelector<HTMLAnchorElement>('a.run-link')?.focus();
    }
  };

  const sortBy = (key: SortKey) => update({ sort: key, dir: state.sort === key && state.dir === 'asc' ? 'desc' : 'asc' });
  const total = runs.data?.length ?? 0;

  return (
    <main className="page list-page">
      <h1>Training runs</h1>
      <div className="list-controls">
        <label className="filter">
          <span>Filter</span>
          <input
            ref={filterRef}
            type="search"
            value={state.q}
            placeholder="name or id  (press / to focus)"
            onChange={(e) => update({ q: e.target.value })}
            onKeyDown={onFilterKey}
            aria-describedby="list-count"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={state.issuesOnly} onChange={(e) => update({ issuesOnly: e.target.checked })} /> Only runs with data issues
        </label>
        <span id="list-count" className="count" aria-live="polite">
          {runs.data ? `${rows.length} of ${total} runs` : ''}
        </span>
      </div>

      {runs.status === 'error' && <ErrorState title="Could not load the run list" error={runs.error} onRetry={runs.retry} />}
      {runs.status === 'loading' && !runs.data && <Skeleton label="Loading runs…" lines={8} />}
      {runs.data && rows.length === 0 && (
        <EmptyState title="No runs match">
          <button type="button" onClick={() => update({ q: '', issuesOnly: false })}>
            Clear filters
          </button>
        </EmptyState>
      )}
      {runs.data && rows.length > 0 && (
        <div className="table-wrap">
          <table className="runs">
            <caption className="visually-hidden">Training runs. Column headers sort the table. Arrow keys move between runs.</caption>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`${c.numeric ? 'num' : ''} ${c.narrowHidden ? 'narrow-hidden' : ''}`}
                    aria-sort={state.sort === c.key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" onClick={() => sortBy(c.key)}>
                      {c.label}
                      <span aria-hidden="true">{state.sort === c.key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={tbodyRef} onKeyDown={onTableKey}>
              {rows.map((r) => {
                const bad = r.lastLoss !== null && !Number.isFinite(r.lastLoss);
                return (
                  <tr key={r.id} data-run={r.id}>
                    <th scope="row">
                      <Link className="run-link" to={`/runs/${encodeURIComponent(r.id)}${search ? `?from=${encodeURIComponent(search)}` : ''}`}>
                        {r.name}
                      </Link>
                    </th>
                    <td>
                      <span className={`status status-${r.status}`}>{r.status}</span>
                    </td>
                    <td className={`num${bad ? ' bad' : ''}`}>{formatValue(r.lastLoss, locale)}</td>
                    <td className="num narrow-hidden">{formatValue(r.minLoss, locale)}</td>
                    <td className="num narrow-hidden">{formatCount(r.points, locale)}</td>
                    <td className="num">{r.issueCount > 0 ? <span className="badge-warn">{formatCount(r.issueCount, locale)}</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
