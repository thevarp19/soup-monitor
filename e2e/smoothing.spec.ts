/** Silent failure: smoothing that hides divergence; log scale with zeros and negatives. */
import { expect, test } from '@playwright/test';
import { expectedRun } from './oracle.ts';
import { generateRun } from '../src/core/generate.ts';
import { normalizeOracle } from '../tests/reference/normalizeOracle.ts';

test('late divergence + EMA 0.999: the chart warns that the smoothing hides the rise', async ({ page }) => {
  const last = expectedRun('late-divergence').summary.lastStep ?? 0;
  await page.goto('/runs/late-divergence?latency=0&locale=en-US');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  await expect(page.getByTestId('ema-warning-loss')).toHaveCount(0); // EMA is off by default
  await page.getByLabel('Smoothing (EMA)').selectOption('0.999');
  const warning = page.getByTestId('ema-warning-loss');
  await expect(warning).toContainText('below the recent raw values');
  const step = Number(/at step ([\d,]+)/.exec((await warning.textContent()) ?? '')?.[1].replace(/,/g, ''));
  expect(step).toBeGreaterThan(0.95 * last); // it points at where the loss turns up
});

test('light smoothing on a healthy run: no warning', async ({ page }) => {
  await page.goto('/runs/healthy-cosine?latency=0');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  await page.getByLabel('Smoothing (EMA)').selectOption('0.6');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('ema-warning-loss')).toHaveCount(0);
});

test('log scale: values ≤ 0 are counted and marked, never drawn as −∞ or silently dropped', async ({ page }) => {
  const o = normalizeOracle(generateRun(expectedRun('log-hostile').spec).raw);
  const lossNonPositive = o.loss.filter((v) => Number.isFinite(v) && v <= 0).length;
  const lrNonPositive = o.lr.filter((v) => Number.isFinite(v) && v <= 0).length;
  expect(lossNonPositive).toBeGreaterThan(0);
  await page.goto('/runs/log-hostile?latency=0&locale=en-US');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  await page.getByLabel('Log scale (y)').check();
  await expect(page.getByTestId('logscale-note-loss')).toHaveText(`▼ ${lossNonPositive.toLocaleString('en-US')} values ≤ 0 cannot be drawn on a log scale: shown as markers at the bottom edge`);
  await expect(page.getByTestId('logscale-note-lr')).toContainText(`▼ ${lrNonPositive} value`); // lr = 0 at step 0 (warmup)
  // and nothing ≤ 0 is handed to the log-scaled plot
  const bad = await page.evaluate(() => {
    const u = (window as unknown as { __charts: Record<string, { data: Array<Array<number | null | undefined>> }> }).__charts.loss;
    return u.data[1].filter((v) => typeof v === 'number' && v <= 0).length;
  });
  expect(bad).toBe(0);
});
