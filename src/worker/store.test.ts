import { describe, expect, it } from 'vitest';
import { downsample } from '../core/downsample.ts';
import { ema } from '../core/ema.ts';
import { generateRun } from '../core/generate.ts';
import { normalize } from '../core/normalize.ts';
import { RUN_SPECS } from '../core/runSpecs.ts';
import { summarize } from '../core/summary.ts';
import { NotFoundError, RunStore } from './store.ts';

const spec = (id: string) => {
  const s = RUN_SPECS.find((r) => r.id === id);
  if (!s) throw new Error(id);
  return s;
};

describe('RunStore', () => {
  it('lists all catalogue runs with summaries and issue counts', () => {
    const list = new RunStore().list();
    expect(list.map((r) => r.id)).toEqual(RUN_SPECS.map((r) => r.id));
    const kitchen = list.find((r) => r.id === 'kitchen-sink');
    expect(kitchen?.summary?.duplicateSteps).toBe(100);
    expect(kitchen?.issueCount).toBeGreaterThan(0);
    expect(list.find((r) => r.id === 'healthy-cosine')?.issueCount).toBe(0);
  });

  it('load(): summary and quality equal the core functions on the generated data', () => {
    const d = new RunStore().load('nan-single');
    const n = normalize(generateRun(spec('nan-single')).raw);
    expect(d.summary).toEqual(summarize(n));
    expect(d.quality).toEqual(n.quality);
    expect([d.firstStep, d.lastStep]).toEqual([0, 39_990]);
  });

  it('load(): unknown run → NotFoundError', () => {
    expect(() => new RunStore().load('nope')).toThrow(NotFoundError);
  });

  it('view(): the same result as downsampling the normalized series directly; breaks encoded as NaN', () => {
    const store = new RunStore();
    store.load('kitchen-sink');
    const v = store.view({ runId: 'kitchen-sink', metric: 'loss', x0: 0, x1: 59_990, width: 640, log: false, emaWeight: null });
    const n = normalize(generateRun(spec('kitchen-sink')).raw);
    const want = downsample({ x: n.step, y: n.loss, gapStarts: n.gapStarts, x0: 0, x1: 59_990, width: 640, log: false });
    expect(Array.from(v.x)).toEqual(Array.from(want.x));
    expect(Array.from(v.y, (y) => (Number.isNaN(y) ? null : y))).toEqual(want.y);
    expect(v.markers).toEqual(want.markers);
    expect(v.ema).toBeNull();
  });

  it('view() with EMA: smoothing computed on the RAW series, then downsampled', () => {
    const store = new RunStore();
    store.load('healthy-cosine');
    const v = store.view({ runId: 'healthy-cosine', metric: 'loss', x0: 10_000, x1: 20_000, width: 50, log: false, emaWeight: 0.9 });
    const n = normalize(generateRun(spec('healthy-cosine')).raw);
    const want = downsample({ x: n.step, y: ema(n.loss, 0.9), gapStarts: n.gapStarts, x0: 10_000, x1: 20_000, width: 50, log: false });
    expect(Array.from(v.ema?.y ?? [], (y) => (Number.isNaN(y) ? null : y))).toEqual(want.y);
  });

  it('view() before load() → NotFoundError (the client must load first)', () => {
    expect(() => new RunStore().view({ runId: 'healthy-cosine', metric: 'loss', x0: 0, x1: 1, width: 10, log: false, emaWeight: null })).toThrow(NotFoundError);
  });
});
