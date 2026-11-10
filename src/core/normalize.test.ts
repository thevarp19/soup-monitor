import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeOracle } from '../../tests/reference/normalizeOracle.ts';
import { generateRun } from './generate.ts';
import { normalize, type NormalizedRun } from './normalize.ts';
import { RUN_SPECS } from './runSpecs.ts';
import type { Columns } from './types.ts';
import { METRICS } from './types.ts';

type Row = [step: number, loss: number, lr?: number, grad_norm?: number];

/** Build columns from literal rows; lr and grad_norm default to recognisable values. */
function cols(rows: Row[]): Columns {
  return {
    step: Float64Array.from(rows, (r) => r[0]),
    loss: Float64Array.from(rows, (r) => r[1]),
    lr: Float64Array.from(rows, (r) => r[2] ?? 0.1),
    grad_norm: Float64Array.from(rows, (r) => r[3] ?? 1),
  };
}
const arr = (a: ArrayLike<number>) => Array.from(a);

describe('normalize — ordering', () => {
  it('sorts rows by step and keeps every row’s values together', () => {
    const out = normalize(cols([
      [30, 3, 0.3, 30],
      [10, 1, 0.1, 10],
      [20, 2, 0.2, 20],
    ]));
    expect(arr(out.step)).toEqual([10, 20, 30]);
    expect(arr(out.loss)).toEqual([1, 2, 3]);
    expect(arr(out.lr)).toEqual([0.1, 0.2, 0.3]);
    expect(arr(out.grad_norm)).toEqual([10, 20, 30]);
    expect(out.quality.orderBreaks).toBe(1);
  });

  it('reports zero order breaks for sorted input', () => {
    const out = normalize(cols([[0, 1], [1, 2], [2, 3]]));
    expect(arr(out.loss)).toEqual([1, 2, 3]);
    expect(out.quality.orderBreaks).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = cols([[30, 3], [10, 1], [10, 9]]);
    normalize(input);
    expect(arr(input.step)).toEqual([30, 10, 10]);
    expect(arr(input.loss)).toEqual([3, 1, 9]);
  });
});

describe('normalize — duplicate steps (policy: last write in log order wins)', () => {
  it('keeps the last write even when it arrives out of order, and counts what it overwrote', () => {
    const out = normalize(cols([[10, 1], [20, 2], [20, 2.5], [30, 3], [20, 2.7]]));
    expect(arr(out.step)).toEqual([10, 20, 30]);
    expect(arr(out.loss)).toEqual([1, 2.7, 3]);
    expect(out.quality.duplicateSteps).toBe(1);
    expect(out.quality.overwrittenRows).toBe(2);
    expect(arr(out.duplicateIndex)).toEqual([1]);
  });

  it('a later NaN overrides an earlier finite value (no "last finite wins" masking)', () => {
    const out = normalize(cols([[5, 1], [5, NaN]]));
    expect(out.loss[0]).toBeNaN();
    expect(out.quality.nonFinite.loss.nan).toBe(1);
  });

  it('a NaN that was later overwritten is still reported (the run did hit NaN before resuming)', () => {
    const out = normalize(cols([[5, NaN], [5, 1]]));
    expect(arr(out.loss)).toEqual([1]);
    expect(out.quality.nonFinite.loss.nan).toBe(0);
    expect(out.quality.overwrittenNonFinite).toBe(1);
  });
});

describe('normalize — NaN and ±Infinity are kept, never replaced', () => {
  it('keeps them at their steps, does not turn them into 0, leaves neighbours untouched', () => {
    const out = normalize(cols([[0, 1], [1, NaN], [2, Infinity], [3, -Infinity], [4, 5]]));
    expect(out.loss[0]).toBe(1);
    expect(out.loss[1]).toBeNaN();
    expect(out.loss[2]).toBe(Infinity);
    expect(out.loss[3]).toBe(-Infinity);
    expect(out.loss[4]).toBe(5);
    expect(out.quality.nonFinite.loss).toEqual({ nan: 1, posInf: 1, negInf: 1 });
    expect(arr(out.nonFiniteIndex.loss)).toEqual([1, 2, 3]);
  });

  it('tracks each metric separately', () => {
    const out = normalize(cols([[0, 1, 0.1, 1], [1, 2, NaN, 1], [2, 3, 0.1, Infinity]]));
    expect(arr(out.nonFiniteIndex.loss)).toEqual([]);
    expect(arr(out.nonFiniteIndex.lr)).toEqual([1]);
    expect(arr(out.nonFiniteIndex.grad_norm)).toEqual([2]);
    expect(out.quality.nonFinite.lr).toEqual({ nan: 1, posInf: 0, negInf: 0 });
    expect(out.quality.nonFinite.grad_norm).toEqual({ nan: 0, posInf: 1, negInf: 0 });
  });
});

describe('normalize — rows with an invalid step', () => {
  it('drops rows whose step is NaN or ±Infinity and counts them', () => {
    const out = normalize(cols([[0, 1], [NaN, 5], [Infinity, 6], [2, 3]]));
    expect(arr(out.step)).toEqual([0, 2]);
    expect(arr(out.loss)).toEqual([1, 3]);
    expect(out.quality.invalidStepRows).toBe(2);
    expect(out.quality.rawRows).toBe(4);
    expect(out.quality.rows).toBe(2);
  });
});

describe('normalize — gaps (spacing > 1.5 × median spacing breaks the line)', () => {
  const steps = (s: number[]) => cols(s.map((x) => [x, 1] as Row));

  it('finds the hole between 30 and 60 when the median spacing is 10', () => {
    const out = normalize(steps([0, 10, 20, 30, 60, 70]));
    expect(arr(out.gapStarts)).toEqual([4]);
    expect(out.quality.gaps).toEqual({ medianStep: 10, threshold: 15, ranges: [{ fromStep: 30, toStep: 60 }] });
  });

  it('treats a single missing point as a gap', () => {
    const out = normalize(steps([0, 10, 20, 40, 50]));
    expect(out.quality.gaps.ranges).toEqual([{ fromStep: 20, toStep: 40 }]);
  });

  it('a spacing of exactly 1.5 × median is not a gap (strictly greater is required)', () => {
    const out = normalize(steps([0, 10, 20, 35, 45]));
    expect(out.quality.gaps.threshold).toBe(15);
    expect(out.quality.gaps.ranges).toEqual([]);
  });

  it('does not treat jitter below the threshold as a gap', () => {
    const out = normalize(steps([0, 10, 21, 30, 41, 50]));
    expect(arr(out.gapStarts)).toEqual([]);
  });

  it('measures spacing on unique steps, so duplicates do not shrink the median', () => {
    // Raw spacing including duplicates would be [0,0,0,0,0,10,10,30] → median 5 → every step a "gap".
    const out = normalize(steps([0, 0, 0, 0, 0, 0, 10, 20, 50]));
    expect(out.quality.gaps.medianStep).toBe(10);
    expect(out.quality.gaps.ranges).toEqual([{ fromStep: 20, toStep: 50 }]);
  });

  it('respects a custom gap factor', () => {
    const out = normalize(steps([0, 10, 20, 30, 60, 70]), { gapFactor: 4 });
    expect(out.quality.gaps.ranges).toEqual([]);
  });

  it('has no spacing statistics for fewer than two rows', () => {
    expect(normalize(steps([5])).quality.gaps).toEqual({ medianStep: null, threshold: null, ranges: [] });
  });
});

describe('normalize — edge cases', () => {
  it('empty input', () => {
    const out = normalize(cols([]));
    expect(out.step.length).toBe(0);
    expect(out.quality.rows).toBe(0);
    expect(out.quality.gaps.ranges).toEqual([]);
  });

  it('single row', () => {
    const out = normalize(cols([[7, 2.5, 0.01, 3]]));
    expect(arr(out.step)).toEqual([7]);
    expect(arr(out.loss)).toEqual([2.5]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based tests: random inputs compared with the independent oracle.

const value = fc.oneof(
  fc.double(), // includes NaN, ±Infinity and -0 by default
  fc.constantFrom(NaN, Infinity, -Infinity, 0),
);
const step = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 40 }) }, // small range → many duplicates
  { weight: 1, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity) },
  { weight: 1, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
);
const rowsArb = fc.array(fc.tuple(step, value, value, value), { maxLength: 200 });

function asPlain(out: NormalizedRun) {
  return {
    step: arr(out.step),
    loss: arr(out.loss),
    lr: arr(out.lr),
    grad_norm: arr(out.grad_norm),
    gapStarts: arr(out.gapStarts),
    duplicateIndex: arr(out.duplicateIndex),
    nonFiniteIndex: Object.fromEntries(METRICS.map((m) => [m, arr(out.nonFiniteIndex[m])])),
    quality: out.quality,
  };
}

describe('normalize — properties', () => {
  it('matches the oracle on arbitrary input (duplicates, NaN, Inf, invalid steps, any order)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const input = cols(rows);
        expect(asPlain(normalize(input))).toEqual(normalizeOracle(input));
      }),
      { numRuns: 500 },
    );
  });

  it('always outputs strictly increasing steps', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const out = normalize(cols(rows));
        for (let i = 1; i < out.step.length; i++) expect(out.step[i]).toBeGreaterThan(out.step[i - 1]);
      }),
      { numRuns: 500 },
    );
  });

  it('gives the same series for any permutation of rows when steps are unique', () => {
    const uniqueRows = fc
      .uniqueArray(fc.integer({ min: 0, max: 10_000 }), { maxLength: 150 })
      .chain((steps) =>
        fc.tuple(
          fc.constant(steps.map((s): Row => [s, s * 0.5 + 1, s * 1e-6, s % 7])),
          fc.shuffledSubarray(steps.map((_, i) => i), { minLength: steps.length }),
        ),
      );
    fc.assert(
      fc.property(uniqueRows, ([rows, perm]) => {
        const sorted = normalize(cols(rows));
        const shuffled = normalize(cols(perm.map((i) => rows[i])));
        for (const key of ['step', ...METRICS] as const) expect(arr(shuffled[key])).toEqual(arr(sorted[key]));
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Cross-check on the real catalogue: normalization must rediscover, from data alone, exactly the
// defects the generator says it injected (two independent derivations of the same facts).

describe.each(RUN_SPECS.map((s) => [s.id, s] as const))('catalogue run %s', (_id, spec) => {
  const { raw, truth } = generateRun(spec);
  const out = normalize(raw);
  const q = out.quality;

  it('counts NaN / +Inf / −Inf per metric exactly as injected', () => {
    for (const m of METRICS) {
      const of = (kind: string) => truth.nonFinite.filter((e) => e.metric === m && e.kind === kind).length;
      expect(q.nonFinite[m], m).toEqual({ nan: of('nan'), posInf: of('+inf'), negInf: of('-inf') });
    }
  });

  it('finds exactly the injected duplicate steps and gaps', () => {
    expect(q.duplicateSteps).toBe(truth.relogged.length);
    expect(q.gaps.ranges).toEqual([...truth.gaps].sort((a, b) => a.fromStep - b.fromStep));
  });

  it('detects the unsorted log order exactly when it was injected', () => {
    expect(q.orderBreaks > 0).toBe(truth.unsorted);
  });

  it('keeps one row per logged step: points minus the removed (gap) rows', () => {
    const removed = spec.defects.reduce((s, d) => s + (d.kind === 'gap' ? d.length : 0), 0);
    expect(q.rows).toBe(spec.points - removed);
  });
});
