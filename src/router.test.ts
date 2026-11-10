import { describe, expect, it } from 'vitest';
import { matchRoute } from './router.ts';

describe('matchRoute', () => {
  it.each([
    ['/', { name: 'list' }],
    ['', { name: 'list' }],
    ['/runs/long-1m', { name: 'run', id: 'long-1m' }],
    ['/runs/long-1m/', { name: 'run', id: 'long-1m' }],
    ['/runs/a%20b', { name: 'run', id: 'a b' }],
    ['/runs/', { name: 'not-found' }],
    ['/runs/a/b', { name: 'not-found' }],
    ['/nope', { name: 'not-found' }],
  ])('%s', (path, want) => {
    expect(matchRoute(path)).toEqual(want);
  });

  it('treats a malformed escape as not found instead of throwing', () => {
    expect(matchRoute('/runs/%E0%A4%A')).toEqual({ name: 'not-found' });
  });
});
