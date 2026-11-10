import { describe, expect, it } from 'vitest';
import { parseApiOptions } from './options.ts';

describe('parseApiOptions — demo/test switches for the mock API', () => {
  it('defaults: random latency 100–1500 ms, no forced failures', () => {
    const o = parseApiOptions('');
    expect(o.latencyFor('healthy-cosine', () => 0)).toBe(100);
    expect(o.latencyFor('healthy-cosine', () => 0.999999)).toBeCloseTo(1500, 0);
    expect(o.fails('healthy-cosine')).toBe(false);
  });

  it('?latency=0 sets a fixed latency for everything', () => {
    expect(parseApiOptions('?latency=0').latencyFor('x', Math.random)).toBe(0);
  });

  it('?latency=id:ms,…,*:ms sets per-run latency with a default', () => {
    const o = parseApiOptions('?latency=diverging:1500,plateau:100,*:50');
    expect(o.latencyFor('diverging', Math.random)).toBe(1500);
    expect(o.latencyFor('plateau', Math.random)).toBe(100);
    expect(o.latencyFor('list', Math.random)).toBe(50);
  });

  it('?fail=id,list forces HTTP 500 for those endpoints', () => {
    const o = parseApiOptions('?fail=plateau,list');
    expect(o.fails('plateau')).toBe(true);
    expect(o.fails('list')).toBe(true);
    expect(o.fails('diverging')).toBe(false);
  });

  it('ignores malformed values instead of throwing', () => {
    const o = parseApiOptions('?latency=abc,x:-5,y:');
    expect(o.latencyFor('x', () => 0)).toBe(100);
  });
});
