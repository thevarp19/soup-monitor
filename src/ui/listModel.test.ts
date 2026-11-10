import { describe, expect, it } from 'vitest';
import { filterRuns, parseListState, serializeListState, sortRuns, type ListItem } from './listModel.ts';

const item = (id: string, over: Partial<ListItem> = {}): ListItem => ({
  id,
  name: id.toUpperCase(),
  status: 'finished',
  points: 100,
  lastLoss: 1,
  minLoss: 1,
  issueCount: 0,
  ...over,
});

describe('list state in the URL', () => {
  it('defaults', () => {
    expect(parseListState('')).toEqual({ q: '', issuesOnly: false, sort: 'name', dir: 'asc' });
  });

  it('round-trips through the query string and omits defaults', () => {
    const s = { q: 'nan', issuesOnly: true, sort: 'lastLoss', dir: 'desc' } as const;
    const qs = serializeListState(s);
    expect(qs).toBe('?q=nan&issues=1&sort=lastLoss&dir=desc');
    expect(parseListState(qs)).toEqual(s);
    expect(serializeListState(parseListState(''))).toBe('');
  });

  it('ignores unknown sort keys and directions instead of breaking the list', () => {
    expect(parseListState('?sort=__proto__&dir=sideways')).toEqual({ q: '', issuesOnly: false, sort: 'name', dir: 'asc' });
  });
});

describe('filterRuns', () => {
  const items = [item('healthy-cosine', { name: 'Healthy · cosine' }), item('nan-series', { name: 'NaN series', issueCount: 200 })];

  it('matches name or id, case-insensitively', () => {
    expect(filterRuns(items, { ...parseListState(''), q: 'NAN' }).map((i) => i.id)).toEqual(['nan-series']);
    expect(filterRuns(items, { ...parseListState(''), q: 'cosine' }).map((i) => i.id)).toEqual(['healthy-cosine']);
  });

  it('"only with data issues"', () => {
    expect(filterRuns(items, { ...parseListState(''), issuesOnly: true }).map((i) => i.id)).toEqual(['nan-series']);
  });
});

describe('sortRuns — missing values never break the order', () => {
  const items = [
    item('a', { lastLoss: 2 }),
    item('b', { lastLoss: NaN }),
    item('c', { lastLoss: 1 }),
    item('d', { lastLoss: null }),
    item('e', { lastLoss: 3 }),
  ];

  it('ascending: numbers first, then NaN, then "no data" — always at the end', () => {
    expect(sortRuns(items, 'lastLoss', 'asc').map((i) => i.id)).toEqual(['c', 'a', 'e', 'b', 'd']);
  });

  it('descending: numbers reversed, NaN and "no data" still at the end', () => {
    expect(sortRuns(items, 'lastLoss', 'desc').map((i) => i.id)).toEqual(['e', 'a', 'c', 'b', 'd']);
  });

  it('is stable for equal keys (ties keep catalogue order)', () => {
    const tied = [item('x', { points: 5 }), item('y', { points: 5 }), item('z', { points: 1 })];
    expect(sortRuns(tied, 'points', 'asc').map((i) => i.id)).toEqual(['z', 'x', 'y']);
    expect(sortRuns(tied, 'points', 'desc').map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('sorts names with a locale-aware collator, not by code points', () => {
    const named = [item('1', { name: 'b' }), item('2', { name: 'B2' }), item('3', { name: 'a' })];
    expect(sortRuns(named, 'name', 'asc').map((i) => i.name)).toEqual(['a', 'b', 'B2']);
  });

  it('does not mutate its input', () => {
    const copy = [...items];
    sortRuns(items, 'lastLoss', 'asc');
    expect(items).toEqual(copy);
  });
});
