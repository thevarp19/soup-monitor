import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s): ${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

test.describe('states', () => {
  test('loading shows a skeleton', async ({ page }) => {
    await page.goto('/runs/healthy-cosine?latency=2000');
    await expect(page.getByRole('status').filter({ hasText: 'Loading run summary' })).toBeAttached();
    await expect(page.getByTestId('card-last-loss')).toBeVisible({ timeout: 10_000 });
  });

  test('server error shows an alert with Retry, and Retry tries again', async ({ page }) => {
    await page.goto('/runs/server-error?latency=0');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('HTTP 500');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('alert')).toContainText('HTTP 500'); // still failing — but it did not get stuck
  });

  test('an empty run says so instead of drawing an empty axis', async ({ page }) => {
    await page.goto('/runs/empty?latency=0');
    await expect(page.getByRole('heading', { name: 'No points logged yet' })).toBeVisible();
    await expect(page.locator('.chart')).toHaveCount(0);
  });

  test('a single-point run draws its point', async ({ page }) => {
    await page.goto('/runs/single-point?latency=0');
    await expect(page.getByTestId('density-loss')).toHaveText('All 1 points shown');
  });

  test('unknown run: 404 error state', async ({ page }) => {
    await page.goto('/runs/does-not-exist?latency=0');
    await expect(page.getByRole('alert')).toContainText('not found');
  });

  test('list endpoint failure (?fail=list) shows an error with Retry', async ({ page }) => {
    await page.goto('/?latency=0&fail=list');
    await expect(page.getByRole('alert')).toContainText('HTTP 500');
  });
});

test.describe('keyboard only', () => {
  test('list: "/" focuses the filter, arrows move between runs, Enter opens one', async ({ page }) => {
    await page.goto('/?latency=0');
    await expect(page.locator('table.runs')).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('nan');
    await expect(page).toHaveURL(/\?q=nan/); // filter state is in the URL
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('a.run-link').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('a.run-link').nth(1)).toBeFocused();
    const name = await page.locator('a.run-link').nth(1).textContent();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name ?? '');
  });

  test('list: sorting via the column header buttons, state kept in the URL', async ({ page }) => {
    await page.goto('/?latency=0');
    await page.getByRole('button', { name: 'Last loss' }).click();
    await expect(page).toHaveURL(/sort=lastLoss/);
    await expect(page.getByRole('columnheader', { name: /Last loss/ })).toHaveAttribute('aria-sort', 'ascending');
    // NaN last losses sort to the end, not into the middle
    const last = await page.locator('tbody tr td:nth-child(3)').allTextContents();
    expect(last.slice(-3)).toEqual(['NaN', 'NaN', '—']);
  });

  test('chart: Tab reaches it, + zooms, → pans, 0 resets', async ({ page }) => {
    await page.goto('/runs/healthy-cosine?latency=0');
    await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
    const label = page.locator('.range-label');
    await expect(label).toHaveText('Steps 0–49,990');
    const frame = page.locator('.chart-frame').first();
    for (let i = 0; i < 20 && !(await frame.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(frame).toBeFocused();
    await page.keyboard.press('+'); // half the span around the centre: 12,497.5–37,492.5, shown as whole steps
    await expect(label).toHaveText('Steps 12,498–37,493');
    await page.keyboard.press('ArrowRight'); // + 10% of the span
    await expect(label).toHaveText('Steps 14,997–39,992'); // 12,497.5 + 2,499.5
    await page.keyboard.press('0');
    await expect(label).toHaveText('Steps 0–49,990');
  });
});

test.describe('accessibility (axe: no serious or critical violations)', () => {
  test('run list', async ({ page }) => {
    await page.goto('/?latency=0');
    await expect(page.locator('table.runs')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('run page with data issues', async ({ page }) => {
    await page.goto('/runs/kitchen-sink?latency=0');
    await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
    expect(await axe(page)).toEqual([]);
  });

  test('error state', async ({ page }) => {
    await page.goto('/runs/server-error?latency=0');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('responsive: 360 px wide, no horizontal page scroll', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const path of ['/?latency=0', '/runs/kitchen-sink?latency=0', '/runs/long-1m?latency=0']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }
});

test('the naive baseline is still reachable at ?impl=naive', async ({ page }) => {
  await page.goto('/runs/healthy-cosine?impl=naive&latency=0');
  await expect(page.getByText('naive baseline')).toBeVisible();
});
