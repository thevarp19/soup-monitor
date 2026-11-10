/** The normalization report: what was wrong with the raw data and what was done about it. */
import type { QualityReport } from '../core/normalize.ts';
import { METRICS } from '../core/types.ts';
import { issueCount } from '../worker/store.ts';
import { formatCount, formatStep, formatValue } from './format.ts';

export function QualityPanel({ quality: q, locale }: { quality: QualityReport; locale: string }) {
  const n = (v: number) => formatCount(v, locale);
  const issues = issueCount(q);
  return (
    <details className="quality" open={issues > 0}>
      <summary>
        Data quality report — {issues === 0 ? 'no issues found' : `${n(issues)} issue${issues === 1 ? '' : 's'} found`}
      </summary>
      <ul>
        <li>
          {n(q.rawRows)} rows received → {n(q.rows)} points after normalization.
        </li>
        <li>
          Order: {q.orderBreaks === 0 ? 'already sorted by step.' : `${n(q.orderBreaks)} place(s) where the step went backwards — sorted by step.`}
        </li>
        <li>
          Duplicate steps: {n(q.duplicateSteps)} (policy: the last write wins; {n(q.overwrittenRows)} earlier row(s) overwritten
          {q.overwrittenNonFinite > 0 ? `, ${n(q.overwrittenNonFinite)} of them contained NaN/∞ — the run hit non-finite values before the rewrite` : ''}).
        </li>
        {q.invalidStepRows > 0 && <li>{n(q.invalidStepRows)} row(s) without a valid step were dropped.</li>}
        {METRICS.map((m) => {
          const c = q.nonFinite[m];
          const total = c.nan + c.posInf + c.negInf;
          return total > 0 ? (
            <li key={m}>
              {m}: {n(c.nan)} NaN, {n(c.posInf)} +∞, {n(c.negInf)} −∞ — kept, drawn as markers, never replaced by 0.
            </li>
          ) : null;
        })}
        <li>
          Gaps: {n(q.gaps.ranges.length)}
          {q.gaps.medianStep !== null && ` (logging interval ${formatValue(q.gaps.medianStep, locale)} steps; a gap is > ${formatValue(q.gaps.threshold, locale)})`}
          {q.gaps.ranges.length > 0 && ': '}
          {q.gaps.ranges
            .slice(0, 5)
            .map((g) => `${formatStep(g.fromStep, locale)}→${formatStep(g.toStep, locale)}`)
            .join(', ')}
          {q.gaps.ranges.length > 5 && ` and ${n(q.gaps.ranges.length - 5)} more`}
          {q.gaps.ranges.length > 0 && ' — the line is broken there, not connected.'}
        </li>
      </ul>
    </details>
  );
}
