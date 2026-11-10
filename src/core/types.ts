export const METRICS = ['loss', 'lr', 'grad_norm'] as const;
export type Metric = (typeof METRICS)[number];

/**
 * Columnar run data. One Float64Array per field instead of an array of
 * `{ step, loss, lr, grad_norm }` objects: 8 bytes per value, no per-object header,
 * and the buffers can be transferred to/from a Web Worker without copying.
 * Values may be NaN or ±Infinity — they are never silently replaced.
 */
export interface Columns {
  step: Float64Array;
  loss: Float64Array;
  lr: Float64Array;
  grad_norm: Float64Array;
}

export type RunStatus = 'running' | 'finished' | 'failed';

export type LrSchedule =
  /** Linear warmup from 0 to `peak` over `warmupSteps`, then cosine decay to `minLr` at the last step. */
  | { kind: 'warmup-cosine'; peak: number; warmupSteps: number; minLr: number }
  /** `initial * gamma^floor(step / everySteps)`. */
  | { kind: 'step-decay'; initial: number; gamma: number; everySteps: number }
  | { kind: 'constant'; value: number };

/** Shape of the clean loss curve. `from` values are fractions of the run in [0, 1]. */
export type LossShape =
  | { kind: 'converge' }
  /** Loss grows exponentially after `from`: multiplied by exp(rate * (t - from)). */
  | { kind: 'diverge'; from: number; rate: number }
  /** Loss stops improving after `from` and stays flat (plus noise). */
  | { kind: 'plateau'; from: number }
  /**
   * grad_norm grows exponentially after `from`, reaches +Infinity at `infAt`, and from `nanFrom`
   * onwards both loss and grad_norm are NaN (what a real fp overflow looks like).
   */
  | { kind: 'explode'; from: number; infAt: number; nanFrom: number }
  /** Clean curve shifted down by `offset`, so late values cross zero and become negative. */
  | { kind: 'shifted'; offset: number };

/**
 * Deliberate data defects. Indices refer to positions in the clean series
 * (index i has step i * stepEvery) before any rows are removed, duplicated or reordered.
 */
export type Defect =
  | { kind: 'nan'; metric: Metric; at: number[] }
  | { kind: 'nan-series'; metric: Metric; from: number; length: number }
  | { kind: 'inf'; metric: Metric; at: number[]; sign: 1 | -1 }
  /** The value at `at` is multiplied by `factor`: one isolated outlier. */
  | { kind: 'spike'; metric: Metric; at: number; factor: number }
  /** Exact zeros (for the log-scale case). */
  | { kind: 'zeros'; metric: Metric; at: number[] }
  /**
   * Resume-from-checkpoint: rows [from, from + length) are logged a second time, with different
   * values, right after the last of them. The second write is the one that should win.
   */
  | { kind: 'relog'; from: number; length: number }
  /** Block [at, at + size) is swapped with the following block (an out-of-order flush). */
  | { kind: 'swap-blocks'; at: number[]; size: number }
  /** Rows [from, from + length) are never logged. */
  | { kind: 'gap'; from: number; length: number };

export interface RunSpec {
  id: string;
  name: string;
  description: string;
  seed: number;
  /** Number of logged points in the clean series (before defects). */
  points: number;
  /** Logging interval in optimizer steps; clean step of index i is i * stepEvery. */
  stepEvery: number;
  status: RunStatus;
  loss: LossShape;
  lr: LrSchedule;
  defects: Defect[];
  /** The mock API answers HTTP 500 for this run's data endpoint. */
  serverError?: boolean;
  /** The run is still training: the mock API reveals points progressively over time. */
  live?: { initialPoints: number; pointsPerSecond: number };
}

/**
 * What the generator deliberately injected, expressed in step space. This is the generator's
 * *intent*; tests check that normalization independently rediscovers the same facts from data.
 */
export interface GroundTruth {
  nonFinite: Array<{ metric: Metric; step: number; kind: 'nan' | '+inf' | '-inf' }>;
  spike: { metric: Metric; step: number; value: number } | null;
  /** Steps that were written more than once (value = number of writes). */
  relogged: Array<{ step: number; writes: number }>;
  /** Missing ranges: last logged step before the hole and first logged step after it. */
  gaps: Array<{ fromStep: number; toStep: number }>;
  /** True if the raw row order is not non-decreasing in step. */
  unsorted: boolean;
}

export interface GeneratedRun {
  spec: RunSpec;
  /** Rows in "log order" (the order the server wrote them), defects included. */
  raw: Columns;
  truth: GroundTruth;
}
