/**
 * Silent failure: a request race when switching runs quickly. The mock API's per-run latency makes
 * the order of responses deterministic. The SAME assertions run against the naive page (where they
 * must fail: the bug is reproduced — `test.fail`) and against the real UI (where they must pass).
 */
import { expect, test, type Page } from '@playwright/test';
import { expectedRun } from './oracle.ts';

const A = 'healthy-cosine'; // 5,000 points, last step 49,990
const B = 'healthy-constant'; // 3,000 points, last step 29,990
const nameA = expectedRun(A).spec.name;
const nameB = expectedRun(B).spec.name;

/** Client-side navigation, like clicking a link (our router listens to popstate). */
async function switchTo(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState(null, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** Records every text the page's <h1> and point counter ever show. */
async function recordScreen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    new MutationObserver(() => w.__seen.push(document.body.innerText)).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

test.describe('A → B: the answer for A arrives AFTER the answer for B', () => {
  const qs = `?latency=${A}:1500,${B}:100,*:0`;

  test('naive page shows A’s data under B’s title (bug reproduced)', async ({ page }) => {
    test.fail(true, 'known bug of the naive baseline: no abort, no request id');
    await page.goto(`/runs/${A}${qs}&impl=naive`);
    await switchTo(page, `/runs/${B}${qs}&impl=naive`);
    await expect(page.getByText('3,000 points')).toBeVisible(); // B arrived
    await page.waitForTimeout(2000); // …then A's late answer
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(B);
    await expect(page.getByText('3,000 points')).toBeVisible({ timeout: 100 }); // naive: shows "5,000 points"
  });

  test('real UI keeps showing B', async ({ page }) => {
    await page.goto(`/runs/${A}${qs}`);
    await switchTo(page, `/runs/${B}${qs}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameB);
    await expect(page.getByTestId('card-last-loss')).toHaveAttribute('data-step', '29990');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameB);
    await expect(page.getByTestId('card-last-loss')).toHaveAttribute('data-step', '29990');
  });
});

test.describe('A → B → A: B’s late answer must not appear after switching back to A', () => {
  const qs = `?latency=${A}:300,${B}:1000,*:0`;

  test('naive page flashes or keeps B’s data under A (bug reproduced)', async ({ page }) => {
    test.fail(true, 'known bug of the naive baseline');
    await page.goto(`/runs/${A}${qs}&impl=naive`);
    await expect(page.getByText('5,000 points')).toBeVisible();
    await recordScreen(page);
    await switchTo(page, `/runs/${B}${qs}&impl=naive`);
    await page.waitForTimeout(100);
    await switchTo(page, `/runs/${A}${qs}&impl=naive`);
    await page.waitForTimeout(1500); // B's answer arrives at ~1,000 ms
    expect((await seen(page)).some((text) => text.includes('3,000 points'))).toBe(false);
  });

  test('real UI never shows B’s data and ends on fresh A', async ({ page }) => {
    await page.goto(`/runs/${A}${qs}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameA);
    await recordScreen(page);
    await switchTo(page, `/runs/${B}${qs}`);
    await page.waitForTimeout(100);
    await switchTo(page, `/runs/${A}${qs}`);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameA);
    await expect(page.getByTestId('card-last-loss')).toHaveAttribute('data-step', '49990');
    expect((await seen(page)).some((text) => text.includes(nameB))).toBe(false);
  });
});
