/**
 * NAIVE BASELINE chart: hands every point to uPlot (no downsampling of our own; uPlot collapses
 * points per pixel internally when there are ≥ 4 per pixel — see docs/experiments.md).
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { markOnce, measureToNextPaint, PERF, zoomSettled, zoomStarted } from '../perf/marks.ts';

export type ChartGroup = Set<uPlot>;

interface Props {
  title: string;
  data: uPlot.AlignedData;
  color: string;
  group: ChartGroup;
  /** Mark `chart:first-draw` when this chart first draws data. */
  firstDrawMark?: boolean;
}

export function NaiveChart({ title, data, color, group, firstDrawMark = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dragging = false;
    const opts: uPlot.Options = {
      title,
      width: el.clientWidth,
      height: 220,
      scales: { x: { time: false } },
      series: [{ label: 'step' }, { label: title, stroke: color, width: 1 }],
      cursor: { sync: { key: 'naive' } },
      hooks: {
        draw: [
          (u) => {
            if (u.data[0].length === 0) return;
            if (firstDrawMark) markOnce('chart:first-draw');
            zoomSettled();
          },
        ],
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const { min, max } = u.scales.x;
            for (const other of group) {
              if (other !== u && (other.scales.x.min !== min || other.scales.x.max !== max)) other.setScale('x', { min: min ?? 0, max: max ?? 0 });
            }
          },
        ],
      },
    };
    const u = new uPlot(opts, data, el);
    group.add(u);

    const onDown = () => (dragging = true);
    const onUp = (e: MouseEvent) => {
      if (dragging) zoomStarted(e.timeStamp);
      dragging = false;
    };
    const onMove = (e: PointerEvent) => measureToNextPaint('hover', e.timeStamp);
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp, { capture: true });
    if (PERF) el.addEventListener('pointermove', onMove);

    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: 220 }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp, { capture: true });
      el.removeEventListener('pointermove', onMove);
      group.delete(u);
      u.destroy();
    };
  }, [title, data, color, group, firstDrawMark]);

  return <div ref={ref} data-chart={title} />;
}
