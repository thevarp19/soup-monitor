/**
 * Summary cards. Each value carries its exact raw number in `data-value` (what e2e compares to the
 * brute-force oracle); the visible text is the formatted value. NaN/±∞ are spelled out.
 */
import type { PointRef, RunSummary } from '../core/summary.ts';
import { formatCount, formatStep, formatValue } from './format.ts';

function Card({ id, label, point, locale, children }: { id: string; label: string; point: PointRef | null; locale: string; children?: React.ReactNode }) {
  const bad = point !== null && !Number.isFinite(point.value);
  return (
    <div className={`card${bad ? ' card-bad' : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={`card-${id}`} data-value={point === null ? '' : String(point.value)} data-step={point === null ? '' : String(point.step)}>
        <span className="card-value">{formatValue(point?.value, locale)}</span>
        {point && <span className="card-sub">at step {formatStep(point.step, locale)}</span>}
        {children}
      </dd>
    </div>
  );
}

export function SummaryCards({ summary, locale }: { summary: RunSummary; locale: string }) {
  const s = summary;
  const lastIsBad = s.lastLoss !== null && !Number.isFinite(s.lastLoss.value);
  return (
    <dl className="cards" aria-label="Run summary">
      <Card id="last-loss" label="Last loss" point={s.lastLoss} locale={locale}>
        {lastIsBad && (
          <span className="card-note" data-testid="card-last-finite-loss" data-value={s.lastFiniteLoss ? String(s.lastFiniteLoss.value) : ''}>
            last finite: {formatValue(s.lastFiniteLoss?.value, locale)}
            {s.lastFiniteLoss && ` at step ${formatStep(s.lastFiniteLoss.step, locale)}`}
          </span>
        )}
      </Card>
      <Card id="min-loss" label="Min loss" point={s.minLoss} locale={locale} />
      <Card id="current-lr" label="Current lr" point={s.currentLr} locale={locale} />
      <Card id="max-grad-norm" label="Max grad_norm" point={s.maxGradNorm} locale={locale}>
        {s.gradNormPosInf > 0 && <span className="card-note">+ {formatCount(s.gradNormPosInf, locale)} × +∞ (overflow)</span>}
      </Card>
      <div className={`card${s.nanCount + s.infCount + s.duplicateSteps + s.gapCount > 0 ? ' card-warn' : ''}`}>
        <dt>Data issues</dt>
        <dd data-testid="card-issues">
          <span className="issue" data-testid="count-nan" data-value={s.nanCount}>
            NaN: {formatCount(s.nanCount, locale)}
          </span>
          <span className="issue" data-testid="count-inf" data-value={s.infCount}>
            ±∞: {formatCount(s.infCount, locale)}
          </span>
          <span className="issue" data-testid="count-duplicates" data-value={s.duplicateSteps}>
            duplicate steps: {formatCount(s.duplicateSteps, locale)}
          </span>
          <span className="issue" data-testid="count-gaps" data-value={s.gapCount}>
            gaps: {formatCount(s.gapCount, locale)}
          </span>
        </dd>
      </div>
    </dl>
  );
}
