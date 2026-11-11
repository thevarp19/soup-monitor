/**
 * Silent failure: stale data. A live run keeps growing; if refreshes start failing, the page must
 * keep the last data, say the refresh failed, and mark it Stale — not keep looking current.
 */
import { expect, test } from '@playwright/test';

test('a live run grows while the page polls it', async ({ page }) => {
  await page.goto('/runs/live?latency=0&poll=1000');
  const density = page.getByTestId('density-loss');
  await expect(density).toContainText('points');
  const count = async () => Number(/of ([\d,]+) points|All ([\d,]+) points/.exec((await density.textContent()) ?? '')?.slice(1).find(Boolean)?.replace(/,/g, ''));
  const first = await count();
  await expect.poll(count, { timeout: 8_000 }).toBeGreaterThan(first);
  await expect(page.getByTestId('freshness')).toContainText('Updated');
  await expect(page.getByText('Stale')).toHaveCount(0);
});

test('refreshes fail: data stays, the failure is shown, and the page turns Stale', async ({ page }) => {
  // first request succeeds, every refresh fails; poll every 1 s, stale after 2.5 s
  await page.goto('/runs/live?latency=0&poll=1000&stale=2500&fail=live@2');
  await expect(page.getByTestId('card-last-loss')).toBeVisible();
  await expect(page.getByTestId('freshness')).toContainText('Last refresh failed: HTTP 500', { timeout: 5_000 });
  await expect(page.getByText('Stale')).toBeVisible({ timeout: 5_000 });
  // the last good data is still on screen, not replaced by an error page
  await expect(page.getByTestId('card-last-loss')).toBeVisible();
  await expect(page.locator('.chart')).toHaveCount(3);
});

test('the update time names its time zone', async ({ page }) => {
  await page.goto('/runs/live?latency=0');
  await expect(page.getByTestId('freshness')).toContainText(/Updated \d{2}:\d{2}:\d{2}( [AP]M)? (GMT|UTC|[A-Z]{3,4})/);
});
