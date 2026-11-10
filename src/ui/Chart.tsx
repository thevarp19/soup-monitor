/**
 * One metric chart. The data never comes from the 1M-point arrays directly: the worker returns a
 * downsampled view for exactly the visible range and the plot's width in DEVICE pixels.
 *
 * uPlot is used as a canvas renderer only: x/y ranges and ticks come from src/core/scale.ts,
 * NaN/Inf/≤0 are drawn as markers by us, isolated points (a break on both sides) as dots.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fetchView } from '../api/mockApi.ts';
import { formatLogTick, formatStepTick, formatTick, linearTicks, logTicks, xTicks, type Ticks } from '../core/scale.ts';
import type { Metric } from '../core/types.ts';
import { useRequest } from '../hooks/useRequest.ts';
import { markOnce, measureToNextPaint, PERF, zoomSettled } from '../perf/marks.ts';
import type { ViewRequest, ViewResult } from '../worker/store.ts';
import { COLORS, withAlpha } from './colors.ts';
import { densityLabel, describeChart, notDrawableCounts } from './describe.ts';
import { formatCount, formatPrecise, formatStep } from './format.ts';
import { readoutBetween, type Readout } from './tooltip.ts';
import { panBy, rangeFromSelection, zoomBy, type Range } from './zoom.ts';

const HEIGHT = 200;
const Y_TICKS = 5;

export interface ChartProps {
  runId: string;
  metric: Metric;
  title: string;
  range: Range;
  full: Range;
  onRange: (r: Range, eventTime: number) => void;
  log: boolean;
  emaWeight: number | null;
  locale: string;
  syncKey: string;
  hintId: string;
  firstDrawMark?: boolean;
}

/** x range actually given to uPlot (a zero-width range is padded so the single point is visible). */
const displayRange = (r: Range): [number, number] => (r.x1 > r.x0 ? [r.x0, r.x1] : [r.x0 - 1, r.x1 + 1]);

function yTicksFor(v: ViewResult | null, log: boolean): Ticks {
  const exts = [v?.extent, v?.ema?.extent].filter((e): e is { min: number; max: number } => !!e);
  if (exts.length === 0) return log ? logTicks(1, 10) : linearTicks(0, 1, Y_TICKS);
  const min = Math.min(...exts.map((e) => e.min));
  const max = Math.max(...exts.map((e) => e.max));
  return log ? logTicks(min, max) : linearTicks(min, max, Y_TICKS);
}

const nullable = (a: Float64Array) => Array.from(a, (n) => (Number.isNaN(n) ? null : n));

function toAligned(v: ViewResult, withEma: boolean): uPlot.AlignedData {
  const y = nullable(v.y);
  if (!withEma || !v.ema) return [v.x, y];
  // Align raw and EMA on one x axis. "Retain" keeps our explicit nulls as breaks; alignment holes
  // become `undefined`, which uPlot spans over (it only breaks lines at null).
  return uPlot.join(
    [
      [Array.from(v.x), y],
      [Array.from(v.ema.x), nullable(v.ema.y)],
    ],
    [[1], [1]] as unknown as uPlot.JoinNullMode[][],
  );
}

/** Points with a break (or nothing) on both sides cannot be drawn as a line: draw them as dots. */
const isolatedPoints: uPlot.Series.Points.Filter = (u, seriesIdx, show) => {
  if (show) return null;
  const ys = u.data[seriesIdx];
  const out: number[] = [];
  const definedNeighbour = (i: number, dir: 1 | -1) => {
    for (let j = i + dir; j >= 0 && j < ys.length; j += dir) if (ys[j] !== undefined) return ys[j];
    return null;
  };
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] === null || ys[i] === undefined) continue;
    if (definedNeighbour(i, -1) === null && definedNeighbour(i, 1) === null) out.push(i);
  }
  return out.length ? out : null;
};

function drawMarkers(u: uPlot, v: ViewResult) {
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  const s = 5 * uPlot.pxRatio;
  ctx.save();
  for (const m of v.markers) {
    const x = u.valToPos(m.step, 'x', true);
    if (x < left - 1 || x > left + width + 1) continue;
    const color = m.kind === 'nan' ? COLORS.markers.nan : m.kind === 'nonpositive' ? COLORS.markers.nonpositive : COLORS.markers.inf;
    // faint guide line so the break is noticeable even when the marker is small
    ctx.strokeStyle = withAlpha(color, 0.35);
    ctx.lineWidth = uPlot.pxRatio;
    ctx.setLineDash([3 * uPlot.pxRatio, 3 * uPlot.pxRatio]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (m.kind === 'nan') {
      // ▲ at the top
      ctx.moveTo(x, top + 1);
      ctx.lineTo(x - s, top + 1 + 1.7 * s);
      ctx.lineTo(x + s, top + 1 + 1.7 * s);
      ctx.closePath();
      ctx.fill();
    } else if (m.kind === 'nonpositive') {
      // ▼ at the bottom
      ctx.moveTo(x, top + height - 1);
      ctx.lineTo(x - s, top + height - 1 - 1.7 * s);
      ctx.lineTo(x + s, top + height - 1 - 1.7 * s);
      ctx.closePath();
      ctx.fill();
    } else {
      // arrow: ↑ at the top for +∞, ↓ at the bottom for −∞
      const up = m.kind === '+inf';
      const tip = up ? top + 1 : top + height - 1;
      const tail = up ? tip + 3 * s : tip - 3 * s;
      ctx.lineWidth = 2 * uPlot.pxRatio;
      ctx.moveTo(x, tail);
      ctx.lineTo(x, tip);
      ctx.moveTo(x - s, up ? tip + s : tip - s);
      ctx.lineTo(x, tip);
      ctx.lineTo(x + s, up ? tip + s : tip - s);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function readoutText(r: Readout | null, locale: string): string {
  if (!r) return 'Hover or focus the chart to read values';
  if (r.kind === 'point') {
    const value = r.nonPositive ? '≤ 0 (cannot be shown on a log scale)' : formatPrecise(r.value, locale);
    return `step ${formatStep(r.step, locale)}: ${value}${r.nearest ? ' (nearest logged step)' : ''}`;
  }
  const issues = [
    r.nan && `${formatCount(r.nan, locale)} NaN`,
    r.posInf && `${formatCount(r.posInf, locale)} +∞`,
    r.negInf && `${formatCount(r.negInf, locale)} −∞`,
    r.nonPositive && `${formatCount(r.nonPositive, locale)} ≤ 0`,
  ].filter(Boolean);
  const extremes = Number.isNaN(r.min)
    ? 'no drawable values'
    : `min ${formatPrecise(r.min, locale)} (step ${formatStep(r.minStep, locale)}) · max ${formatPrecise(r.max, locale)} (step ${formatStep(r.maxStep, locale)})`;
  return `steps ${formatStep(r.fromStep, locale)}–${formatStep(r.toStep, locale)} · ${formatCount(r.count, locale)} points · ${extremes}${issues.length ? ` · ${issues.join(', ')}` : ''}`;
}

export function Chart(props: ChartProps) {
  const { runId, metric, title, range, full, onRange, log, emaWeight, locale, syncKey, hintId, firstDrawMark = false } = props;
  const plotEl = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const viewRef = useRef<{ view: ViewResult; range: Range } | null>(null);
  const ticksRef = useRef<Ticks>(linearTicks(0, 1, Y_TICKS));
  const rangeRef = useRef(range);
  const fullRef = useRef(full);
  const onRangeRef = useRef(onRange);
  const [widthPx, setWidthPx] = useState(0);
  const [readout, setReadout] = useState<Readout | null>(null);
  const summaryId = useId();
  const titleId = useId();
  const emaOn = emaWeight !== null;
  const color = COLORS.series[metric];

  useEffect(() => {
    rangeRef.current = range;
    fullRef.current = full;
    onRangeRef.current = onRange;
  }, [range, full, onRange]);

  // Create the plot (again only when its structure changes).
  useEffect(() => {
    const el = plotEl.current;
    if (!el) return;
    let lastPointerUp = 0;
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 100),
      height: HEIGHT,
      legend: { show: false },
      cursor: { sync: { key: syncKey }, drag: { x: true, y: false, setScale: false }, points: { show: false } },
      scales: {
        x: { time: false, auto: false, range: () => displayRange(rangeRef.current) },
        y: log ? { distr: 3, log: 10, auto: false, range: () => [ticksRef.current.min, ticksRef.current.max] } : { auto: false, range: () => [ticksRef.current.min, ticksRef.current.max] },
      },
      axes: [
        {
          stroke: COLORS.axisText,
          grid: { stroke: COLORS.grid, width: 1 },
          ticks: { stroke: COLORS.grid },
          splits: (u) => xTicks(rangeRef.current.x0, rangeRef.current.x1, Math.max(2, Math.floor(u.bbox.width / uPlot.pxRatio / 110))),
          values: (_u, splits) => splits.map((v) => formatStepTick(v, locale)),
        },
        {
          stroke: COLORS.axisText,
          size: 64,
          grid: { stroke: COLORS.grid, width: 1 },
          ticks: { stroke: COLORS.grid },
          splits: () => ticksRef.current.ticks,
          values: (_u, splits) => {
            const t = ticksRef.current;
            const magnitude = Math.max(Math.abs(t.min), Math.abs(t.max));
            return splits.map((v) => (log ? formatLogTick(v, locale) : formatTick(v, t.step, locale, magnitude)));
          },
        },
      ],
      series: [
        {},
        {
          label: title,
          stroke: emaOn ? withAlpha(color, COLORS.rawAlphaWithEma) : color,
          width: 1,
          spanGaps: false,
          points: { show: false, filter: isolatedPoints, size: 5, fill: color, stroke: color },
        },
        ...(emaOn ? [{ label: `${title} (EMA)`, stroke: color, width: 2, dash: [6, 4], spanGaps: false, points: { show: false } }] : []),
      ],
      hooks: {
        draw: [
          (u) => {
            const current = viewRef.current;
            if (!current) return;
            drawMarkers(u, current.view);
            if (firstDrawMark) markOnce('chart:first-draw');
            const r = rangeRef.current;
            if (current.range.x0 === r.x0 && current.range.x1 === r.x1) zoomSettled();
          },
        ],
        setSelect: [
          (u) => {
            if (u.select.width <= 0) return;
            const a = u.posToVal(u.select.left, 'x');
            const b = u.posToVal(u.select.left + u.select.width, 'x');
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            const r = rangeFromSelection(a, b, fullRef.current);
            if (r) onRangeRef.current(r, lastPointerUp || performance.now());
          },
        ],
        setCursor: [
          (u) => {
            const left = u.cursor.left ?? -1;
            const current = viewRef.current;
            if (left < 0 || !current) return setReadout(null);
            // The pointer has ~1 CSS px resolution: report everything drawn under that pixel.
            const a = u.posToVal(left - 0.5, 'x');
            const b = u.posToVal(left + 0.5, 'x');
            setReadout(readoutBetween(current.view, current.range.x0, current.range.x1, a, b));
          },
        ],
      },
    };
    const u = new uPlot(opts, [[], []], el);
    plotRef.current = u;
    (window as unknown as { __charts?: Record<string, uPlot> }).__charts ??= {};
    (window as unknown as { __charts: Record<string, uPlot> }).__charts[metric] = u;

    const onUp = (e: MouseEvent) => (lastPointerUp = e.timeStamp);
    const onMove = (e: PointerEvent) => measureToNextPaint('hover', e.timeStamp);
    const onDbl = (e: MouseEvent) => onRangeRef.current(fullRef.current, e.timeStamp);
    el.addEventListener('mouseup', onUp, { capture: true });
    el.addEventListener('dblclick', onDbl);
    if (PERF) el.addEventListener('pointermove', onMove);
    const ro = new ResizeObserver(() => {
      u.setSize({ width: Math.max(el.clientWidth, 100), height: HEIGHT });
      setWidthPx(Math.round(u.bbox.width)); // canvas pixels = CSS px × devicePixelRatio
    });
    ro.observe(el);

    // If a view is already known (structure change, e.g. log toggled), draw it right away.
    return () => {
      ro.disconnect();
      el.removeEventListener('mouseup', onUp, { capture: true });
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointermove', onMove);
      u.destroy();
      plotRef.current = null;
      viewRef.current = null;
    };
  }, [metric, title, color, log, emaOn, locale, syncKey, firstDrawMark]);

  // Request the downsampled view for the visible range at the plot's device-pixel width.
  const reqKey = widthPx > 0 ? JSON.stringify({ runId, metric, x0: range.x0, x1: range.x1, width: widthPx, log, emaWeight } satisfies ViewRequest) : '';
  const fetcher = useCallback((key: string, signal: AbortSignal) => (key ? fetchView(JSON.parse(key) as ViewRequest, { signal }) : new Promise<ViewResult>(() => {})), []);
  const view = useRequest(reqKey, fetcher, { keepPrevious: true });

  // Stretch what is drawn to a new range immediately; the matching view follows from the worker.
  useEffect(() => {
    plotRef.current?.setScale('x', { min: range.x0, max: range.x1 });
  }, [range.x0, range.x1]);

  // Draw a view when it arrives.
  useEffect(() => {
    const u = plotRef.current;
    const v = view.data;
    if (!u || !v || !view.dataKey) return;
    const req = JSON.parse(view.dataKey) as ViewRequest;
    if (req.runId !== runId || req.metric !== metric || req.log !== log || (req.emaWeight !== null) !== emaOn) return;
    viewRef.current = { view: v, range: { x0: req.x0, x1: req.x1 } };
    ticksRef.current = yTicksFor(v, log);
    const [dx0, dx1] = displayRange(rangeRef.current);
    u.batch(() => {
      u.setData(toAligned(v, emaOn), false);
      u.setScale('x', { min: dx0, max: dx1 });
      u.setScale('y', { min: ticksRef.current.min, max: ticksRef.current.max });
    });
  }, [view.data, view.dataKey, runId, metric, log, emaOn]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let r: Range | null = null;
    if (e.key === '+' || e.key === '=') r = zoomBy(range, full, 0.5);
    else if (e.key === '-' || e.key === '_') r = zoomBy(range, full, 2);
    else if (e.key === 'ArrowLeft') r = panBy(range, full, -0.1);
    else if (e.key === 'ArrowRight') r = panBy(range, full, 0.1);
    else if (e.key === '0') r = full;
    if (!r) return;
    e.preventDefault();
    onRange(r, e.timeStamp);
  };

  const v = view.data;
  const vr = view.dataKey ? (JSON.parse(view.dataKey) as ViewRequest) : null;
  const counts = v ? notDrawableCounts(v) : null;
  const notDrawable = counts ? counts.nan + counts.posInf + counts.negInf + counts.nonPositive : 0;

  return (
    <figure className="chart" aria-busy={view.status === 'loading'}>
      <figcaption className="chart-head">
        <h3 id={titleId}>{title}</h3>
        <output className="readout" data-testid={`readout-${metric}`}>
          {readoutText(readout, locale)}
        </output>
      </figcaption>
      <div className="chart-frame" tabIndex={0} role="group" aria-roledescription="chart" aria-labelledby={titleId} aria-describedby={`${summaryId} ${hintId}`} onKeyDown={onKeyDown}>
        <div ref={plotEl} aria-hidden="true" data-chart={metric} />
      </div>
      <p className="chart-meta">
        <span data-testid={`density-${metric}`}>{v ? densityLabel(v.drawnCount, v.sourceCount, notDrawable, locale) : 'Loading…'}</span>
        {counts && notDrawable > 0 && (
          <span className="legend">
            {counts.nan > 0 && <span className="lg-nan">▲ NaN ×{formatCount(counts.nan, locale)}</span>}
            {counts.posInf > 0 && <span className="lg-inf">↑ +∞ ×{formatCount(counts.posInf, locale)}</span>}
            {counts.negInf > 0 && <span className="lg-inf">↓ −∞ ×{formatCount(counts.negInf, locale)}</span>}
            {counts.nonPositive > 0 && <span className="lg-nonpos">▼ ≤ 0 not shown on log scale ×{formatCount(counts.nonPositive, locale)}</span>}
          </span>
        )}
        {emaOn && <span className="legend">solid thin: raw · dashed thick: EMA (smoothed)</span>}
      </p>
      <p id={summaryId} className="visually-hidden">
        {v && vr ? describeChart(metric, v, vr.x0, vr.x1, locale) : `${title}: loading`}
      </p>
    </figure>
  );
}
