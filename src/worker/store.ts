/**
 * Everything the data worker does, as a plain class (unit-testable without a Worker).
 *
 * Roles: generateRun() plays the "server" that returns raw, broken rows; normalize() is the
 * client-side defence against them. Normalized columns stay here; the main thread only receives
 * summaries and downsampled views for the visible range.
 */
import { smoothingGap } from '../core/divergence.ts';
import { downsample, lowerBound, upperBound, type BucketStats, type Marker } from '../core/downsample.ts';
import { ema } from '../core/ema.ts';
import { generateRun } from '../core/generate.ts';
import { normalize, type NormalizedRun, type QualityReport } from '../core/normalize.ts';
import { RUN_SPECS } from '../core/runSpecs.ts';
import { visibleExtent } from '../core/scale.ts';
import { summarize, type RunSummary } from '../core/summary.ts';
import type { Columns, Metric, RunSpec, RunStatus } from '../core/types.ts';

export class NotFoundError extends Error {
  readonly status = 404;
}

export interface RunMeta {
  id: string;
  name: string;
  description: string;
  status: RunStatus;
  /** Still training: new points keep arriving (the client polls it). */
  live: boolean;
}

export interface RunListItem extends RunMeta {
  points: number;
  summary: RunSummary;
  /** NaN/Inf values + duplicate steps + gaps + order breaks + invalid-step rows. */
  issueCount: number;
}

export interface RunDetails extends RunMeta {
  summary: RunSummary;
  quality: QualityReport;
  firstStep: number | null;
  lastStep: number | null;
}

export interface ViewRequest {
  runId: string;
  metric: Metric;
  x0: number;
  x1: number;
  width: number;
  log: boolean;
  emaWeight: number | null;
}

export interface ViewResult {
  x: Float64Array;
  /** NaN = line break (a non-drawable raw value is never emitted, so NaN is unambiguous here). */
  y: Float64Array;
  interiorFrom: number;
  interiorTo: number;
  markers: Marker[];
  buckets: BucketStats;
  sourceCount: number;
  drawnCount: number;
  extent: { min: number; max: number } | null;
  ema: {
    x: Float64Array;
    y: Float64Array;
    extent: { min: number; max: number } | null;
    /** Largest gap between the EMA and the recent raw values in the visible range. */
    gap: { maxRelGap: number; atStep: number; smoothedIs: 'above' | 'below' } | null;
  } | null;
}

export function issueCount(q: QualityReport): number {
  const nf = q.nonFinite;
  const nonFinite = [nf.loss, nf.lr, nf.grad_norm].reduce((s, c) => s + c.nan + c.posInf + c.negInf, 0);
  return nonFinite + q.duplicateSteps + q.gaps.ranges.length + q.orderBreaks + q.invalidStepRows;
}

const meta = (s: RunSpec): RunMeta => ({ id: s.id, name: s.name, description: s.description, status: s.status, live: s.live !== undefined });
const toF64 = (y: Array<number | null>) => Float64Array.from(y, (v) => (v === null ? NaN : v));

export class RunStore {
  private readonly runs = new Map<string, NormalizedRun>();
  private readonly smoothed = new Map<string, Float64Array>();
  private readonly liveRaw = new Map<string, Columns>();
  private readonly startedAt: number;

  /** `now` is injectable so tests can move time; the live run grows from the store's creation. */
  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  private spec(id: string): RunSpec {
    const s = RUN_SPECS.find((r) => r.id === id);
    if (!s) throw new NotFoundError(`run "${id}" not found`);
    return s;
  }

  private ensure(id: string): NormalizedRun {
    const spec = this.spec(id);
    if (spec.live) return this.ensureLive(spec, spec.live);
    let run = this.runs.get(id);
    if (!run) {
      run = normalize(generateRun(spec).raw);
      this.runs.set(id, run);
    }
    return run;
  }

  /** A live run exposes only the rows "logged so far": initialPoints + pointsPerSecond × elapsed. */
  private ensureLive(spec: RunSpec, live: NonNullable<RunSpec['live']>): NormalizedRun {
    let raw = this.liveRaw.get(spec.id);
    if (!raw) {
      raw = generateRun(spec).raw;
      this.liveRaw.set(spec.id, raw);
    }
    const elapsedS = Math.max(0, this.now() - this.startedAt) / 1000;
    const n = Math.min(raw.step.length, live.initialPoints + Math.floor(elapsedS * live.pointsPerSecond));
    const cached = this.runs.get(spec.id);
    if (cached && cached.quality.rawRows === n) return cached;
    const r = raw;
    const run = normalize({ step: r.step.subarray(0, n), loss: r.loss.subarray(0, n), lr: r.lr.subarray(0, n), grad_norm: r.grad_norm.subarray(0, n) });
    this.runs.set(spec.id, run);
    return run;
  }

  list(): RunListItem[] {
    return RUN_SPECS.map((s) => {
      const run = this.ensure(s.id);
      return { ...meta(s), points: run.step.length, summary: summarize(run), issueCount: issueCount(run.quality) };
    });
  }

  load(id: string): RunDetails {
    const run = this.ensure(id);
    const n = run.step.length;
    return {
      ...meta(this.spec(id)),
      summary: summarize(run),
      quality: run.quality,
      firstStep: n ? run.step[0] : null,
      lastStep: n ? run.step[n - 1] : null,
    };
  }

  view(req: ViewRequest): ViewResult {
    const run = this.runs.get(req.runId);
    if (!run) throw new NotFoundError(`run "${req.runId}" is not loaded`);
    const base = { x0: req.x0, x1: req.x1, width: req.width, log: req.log, gapStarts: run.gapStarts, x: run.step };
    const d = downsample({ ...base, y: run[req.metric] });
    let smooth: ViewResult['ema'] = null;
    if (req.emaWeight !== null) {
      const key = `${req.runId}:${req.metric}:${req.emaWeight}:${run.step.length}`; // live runs grow
      let y = this.smoothed.get(key);
      if (!y) {
        y = ema(run[req.metric], req.emaWeight);
        this.smoothed.set(key, y);
      }
      const e = downsample({ ...base, y });
      const g = smoothingGap(run[req.metric], y, lowerBound(run.step, req.x0), upperBound(run.step, req.x1) - 1);
      smooth = { x: e.x, y: toF64(e.y), extent: visibleExtent(e), gap: g && { maxRelGap: g.maxRelGap, atStep: run.step[g.atIndex], smoothedIs: g.smoothedIs } };
    }
    return {
      x: d.x,
      y: toF64(d.y),
      interiorFrom: d.interiorFrom,
      interiorTo: d.interiorTo,
      markers: d.markers,
      buckets: d.buckets,
      sourceCount: d.sourceCount,
      drawnCount: d.drawnCount,
      extent: visibleExtent(d),
      ema: smooth,
    };
  }
}
