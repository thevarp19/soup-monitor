/**
 * Run list: filter, sort and URL state — pure functions.
 *
 * Sorting rule that prevents a silent failure: a comparator like `(a, b) => a.loss - b.loss`
 * returns NaN for runs whose last loss is NaN, which makes Array.prototype.sort's result
 * implementation-defined (the list just looks "a bit off"). Here missing values are ranked
 * explicitly: numbers first, then NaN, then "no data" — at the end in BOTH directions.
 */
export const SORT_KEYS = ['name', 'status', 'points', 'lastLoss', 'minLoss', 'issues'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export interface ListItem {
  id: string;
  name: string;
  status: string;
  points: number;
  lastLoss: number | null;
  minLoss: number | null;
  issueCount: number;
}

export interface ListState {
  q: string;
  issuesOnly: boolean;
  sort: SortKey;
  dir: SortDir;
}

const DEFAULTS: ListState = { q: '', issuesOnly: false, sort: 'name', dir: 'asc' };

export function parseListState(search: string): ListState {
  const p = new URLSearchParams(search);
  const sort = p.get('sort');
  const dir = p.get('dir');
  return {
    q: p.get('q') ?? DEFAULTS.q,
    issuesOnly: p.get('issues') === '1',
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : DEFAULTS.sort,
    dir: dir === 'desc' ? 'desc' : 'asc',
  };
}

export function serializeListState(s: ListState): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.issuesOnly) p.set('issues', '1');
  if (s.sort !== DEFAULTS.sort) p.set('sort', s.sort);
  if (s.dir !== DEFAULTS.dir) p.set('dir', s.dir);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export function filterRuns<T extends ListItem>(items: T[], s: ListState): T[] {
  const q = s.q.trim().toLowerCase();
  return items.filter(
    (i) => (!q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) && (!s.issuesOnly || i.issueCount > 0),
  );
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function numericKey(i: ListItem, key: SortKey): number | null {
  switch (key) {
    case 'points':
      return i.points;
    case 'lastLoss':
      return i.lastLoss;
    case 'minLoss':
      return i.minLoss;
    case 'issues':
      return i.issueCount;
    default:
      return null;
  }
}

/** 0 = a number, 1 = NaN, 2 = no value. */
const rank = (v: number | null) => (v === null ? 2 : Number.isNaN(v) ? 1 : 0);

export function sortRuns<T extends ListItem>(items: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      let c: number;
      if (key === 'name' || key === 'status') {
        c = sign * collator.compare(a.item[key], b.item[key]);
      } else {
        const va = numericKey(a.item, key);
        const vb = numericKey(b.item, key);
        const ra = rank(va);
        const rb = rank(vb);
        c = ra !== rb ? ra - rb : ra === 0 ? sign * ((va as number) - (vb as number)) : 0;
      }
      return c !== 0 ? c : a.index - b.index;
    })
    .map((x) => x.item);
}
