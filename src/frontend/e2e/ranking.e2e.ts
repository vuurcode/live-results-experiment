import { expect, test } from '@playwright/test';

const RANKING = '/ranking?competitionId=e2e-lanes';

test.describe('ranking page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(RANKING);
    await expect(page.locator('.ranking-table').first()).toBeVisible({ timeout: 15_000 });
  });

  test('shows the disclaimer and one table per distance with the fastest first', async ({ page }) => {
    await expect(page.locator('.disclaimer')).toBeVisible();
    await expect(page.locator('.ranking-distance-name').first()).toHaveText(/500/);
    const rows = page.locator('.ranking-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(1);
    const times = await page.locator('.ranking-table tbody tr:not(.unranked) td.num-col:nth-child(3)').allInnerTexts();
    const seconds = times.map((t) => t.split(':').reduce((a, p) => a * 60 + parseFloat(p), 0));
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
  });

  test('unranked rows come after the ranked ones and show the reason instead of a time', async ({ page }) => {
    const unranked = page.locator('.ranking-table tbody tr.unranked');
    await expect(unranked.first()).toBeVisible();
    await expect(unranked.first().locator('.rank-col')).toHaveText('');
    await expect(unranked.first()).toContainText(/DNF|DNS|DQ/i);
    expect(await page.locator('.ranking-table tbody tr:not(.unranked) ~ tr.unranked').count()).toBeGreaterThan(0);
  });

  test('a row links to the heat of that skater on the dashboard', async ({ page }) => {
    const link = page.locator('.row-link').first();
    const name = (await link.innerText()).trim();
    await link.click();
    await expect(page).toHaveURL(/competitionId=e2e-lanes/);
    await expect(page.locator('.individual-comp-name', { hasText: name }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('the back link returns to the dashboard and keeps the competition', async ({ page }) => {
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/competitionId=e2e-lanes/);
    await expect(page).not.toHaveURL(/ranking/);
  });
});
