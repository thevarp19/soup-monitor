/**
 * Silent failure: locale and time zone. The browser's locale and zone are emulated; nothing is
 * passed in the URL. Card values must be formatted for that locale (and still be the oracle's
 * values), times must name the zone, and typed numbers must be read in that locale.
 */
import { expect, test } from '@playwright/test';
import { formatValue } from '../src/ui/format.ts';
import { expectedRun } from './oracle.ts';

const cases = [
  { locale: 'de-DE', timezoneId: 'America/Los_Angeles', zone: /GMT-8|GMT-7|PST|PDT/, step: '500.000', range: /Steps 49[0-9]\.[0-9]{3}–5[01][0-9]\.[0-9]{3}/ },
  { locale: 'ru-RU', timezoneId: 'Asia/Almaty', zone: /GMT\+5/, step: '500 000', range: /Steps 49[0-9]\s[0-9]{3}–5[01][0-9]\s[0-9]{3}/ },
  { locale: 'en-US', timezoneId: 'Asia/Almaty', zone: /GMT\+5/, step: '500,000', range: /Steps 49[0-9],[0-9]{3}–5[01][0-9],[0-9]{3}/ },
];

for (const c of cases) {
  test.describe(`${c.locale}, ${c.timezoneId}`, () => {
    test.use({ locale: c.locale, timezoneId: c.timezoneId });

    test('cards use the browser locale and still show the oracle’s values', async ({ page }) => {
      const { summary } = expectedRun('kitchen-sink');
      await page.goto('/runs/kitchen-sink?latency=0');
      const card = page.getByTestId('card-min-loss');
      await expect(card).toHaveAttribute('data-value', String(summary.minLoss?.value));
      await expect(card.locator('.card-value')).toHaveText(formatValue(summary.minLoss?.value, c.locale));
      await expect(page.locator('.footer')).toContainText(c.locale);
    });

    test('the load time names the time zone', async ({ page }) => {
      await page.goto('/runs/healthy-cosine?latency=0');
      await expect(page.getByTestId('freshness')).toContainText(c.zone);
    });

    test(`"Go to step" reads ${c.step} as step 500,000`, async ({ page }) => {
      await page.goto('/runs/long-1m?latency=0');
      await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…', { timeout: 30_000 });
      await page.getByLabel('Go to step').fill(c.step);
      await page.getByLabel('Go to step').press('Enter');
      await expect(page.locator('.range-label')).toHaveText(c.range);
    });
  });
}

test('"Go to step" rejects a non-integer instead of silently truncating it', async ({ page }) => {
  await page.goto('/runs/healthy-cosine?latency=0&locale=en-US');
  await expect(page.getByTestId('density-loss')).not.toHaveText('Loading…');
  await page.getByLabel('Go to step').fill('1,5');
  await page.getByLabel('Go to step').press('Enter');
  await expect(page.getByTestId('goto-error')).toHaveText('Steps are whole numbers — 1,5 reads as 1.5.');
  await expect(page.locator('.range-label')).toHaveText('Steps 0–49,990');
});
