import { expect, test, type Page } from '@playwright/test';
import { formatPrecise, formatStep, formatValue } from '../src/ui/format.ts';
import { expectedRun } from './oracle.ts';

const EN = 'en-US';

async function openRun(page: Page, id: string) {
  await page.goto(`/runs/${id}?latency=0&locale=${EN}`);
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…', { timeout: 30_000 });
}

test.describe('summary cards equal the brute-force oracle', () => {
  for (const id of ['nan-single', 'kitchen-sink', 'long-1m', 'grad-explosion']) {
    test(id, async ({ page }) => {
      const { summary: s } = expectedRun(id);
      await openRun(page, id);
      const cards: Array<[string, { step: number; value: number } | null]> = [
        ['card-last-loss', s.lastLoss],
        ['card-min-loss', s.minLoss],
        ['card-current-lr', s.currentLr],
        ['card-max-grad-norm', s.maxGradNorm],
      ];
      for (const [testId, want] of cards) {
        const card = page.getByTestId(testId);
        // exact raw value and step…
        await expect(card).toHaveAttribute('data-value', want ? String(want.value) : '');
        await expect(card).toHaveAttribute('data-step', want ? String(want.step) : '');
        // …and the visible text is that value, formatted
        await expect(card.locator('.card-value')).toHaveText(formatValue(want?.value, EN));
      }
      await expect(page.getByTestId('count-nan')).toHaveAttribute('data-value', String(s.nanCount));
      await expect(page.getByTestId('count-inf')).toHaveAttribute('data-value', String(s.infCount));
      await expect(page.getByTestId('count-duplicates')).toHaveAttribute('data-value', String(s.duplicateSteps));
      await expect(page.getByTestId('count-gaps')).toHaveAttribute('data-value', String(s.gapCount));
    });
  }

  test('nan-single: the last loss card says NaN and shows the last finite value separately', async ({ page }) => {
    const { summary: s } = expectedRun('nan-single');
    await openRun(page, 'nan-single');
    await expect(page.getByTestId('card-last-loss').locator('.card-value')).toHaveText('NaN');
    await expect(page.getByTestId('card-last-finite-loss')).toHaveAttribute('data-value', String(s.lastFiniteLoss?.value));
  });
});

/** Pixel position (relative to the page) of a data point on a chart, via the uPlot instance. */
async function pointOnPage(page: Page, metric: string, step: number, value: number) {
  const box = await page.locator(`[data-chart="${metric}"] .u-over`).boundingBox();
  if (!box) throw new Error('chart not found');
  const pos = await page.evaluate(
    ([m, s, v]) => {
      const u = (window as unknown as { __charts: Record<string, { valToPos(v: number, k: string): number }> }).__charts[m as string];
      return { x: u.valToPos(s as number, 'x'), y: u.valToPos(v as number, 'y') };
    },
    [metric, step, value] as const,
  );
  return { x: box.x + pos.x, y: box.y + pos.y, box };
}

const { truth: longTruth } = expectedRun('long-1m');
const spike = longTruth.spike;
if (!spike) throw new Error('long-1m has no spike');

for (const dpr of [1, 2]) test.describe(`the 1M-point spike (devicePixelRatio ${dpr})`, () => {
  test.use({ deviceScaleFactor: dpr });

  test('hovering its step shows the exact raw value at full zoom (1 pixel ≈ 1,000 steps)', async ({ page }) => {
    await openRun(page, 'long-1m');
    const p = await pointOnPage(page, 'loss', spike.step, spike.value);
    await page.mouse.move(p.x, p.box.y + p.box.height / 2);
    const readout = page.getByTestId('readout-loss');
    await expect(readout).toContainText(`max ${formatPrecise(spike.value, EN)} (step ${formatStep(spike.step, EN)})`);
  });

  test('after zooming in with the keyboard it is still there, at every level', async ({ page }) => {
    await openRun(page, 'long-1m');
    const frame = page.locator('.chart-frame').first();
    await frame.focus();
    for (let i = 0; i < 6; i++) {
      await frame.press('+'); // zooms around the centre, where the spike is
      await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
      await page.waitForTimeout(150);
      const p = await pointOnPage(page, 'loss', spike.step, spike.value);
      await page.mouse.move(p.x, p.box.y + p.box.height / 2);
      await expect(page.getByTestId('readout-loss')).toContainText(formatPrecise(spike.value, EN));
    }
  });

  test('canvas pixels: the line actually reaches the spike height at the spike column, and nowhere else', async ({ page }) => {
    await openRun(page, 'long-1m');
    await page.mouse.move(0, 0); // no cursor lines over the plot
    const result = await page.evaluate(
      ([step, value]) => {
        const u = (window as unknown as { __charts: Record<string, { ctx: CanvasRenderingContext2D; valToPos(v: number, k: string, c?: boolean): number; bbox: { top: number; height: number } }> }).__charts.loss;
        const sx = Math.round(u.valToPos(step, 'x', true));
        const sy = Math.round(u.valToPos(value, 'y', true));
        const blue = (d: Uint8ClampedArray, i: number) => d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 20; // ≈ #0b5cad, antialiased
        const topBlueRow = (x: number) => {
          const col = u.ctx.getImageData(x - 2, u.bbox.top, 5, u.bbox.height).data;
          for (let row = 0; row < u.bbox.height; row++) for (let dx = 0; dx < 5; dx++) if (blue(col, (row * 5 + dx) * 4)) return u.bbox.top + row;
          return null;
        };
        const away = Math.round(u.valToPos(step * 0.6, 'x', true));
        return { sy, y10: u.valToPos(10, 'y', true), spikeTop: topBlueRow(sx), awayTop: topBlueRow(away) };
      },
      [spike.step, spike.value] as const,
    );
    expect(result.spikeTop, 'no line pixels at the spike column').not.toBeNull();
    expect(Math.abs((result.spikeTop ?? 0) - result.sy)).toBeLessThanOrEqual(4); // top of the drawn line = spike height (±4 device px)
    expect(result.awayTop).not.toBeNull();
    expect(result.awayTop).toBeGreaterThan(result.y10); // elsewhere the line stays below loss = 10 (raw max there ≈ 4)
  });
});
