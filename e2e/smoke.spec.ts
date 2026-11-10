import { expect, test } from '@playwright/test';

test('app loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?latency=0');
  await expect(page.getByRole('heading', { level: 1, name: 'Training runs' })).toBeVisible();
  await expect(page.locator('a.run-link')).toHaveCount(20);
  await page.goto('/runs/kitchen-sink?latency=0');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  expect(errors).toEqual([]);
});
