import { expect, test } from '@playwright/test';

const START_LIST = '/start-list?competitionId=e2e-lanes';

test.describe('start list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(START_LIST);
    await page.evaluate(() => localStorage.clear());
    await page.goto(START_LIST);
    await expect(page.locator('.start-list-heat').first()).toBeVisible({ timeout: 15_000 });
  });

  test('lists every heat with its racers in order', async ({ page }) => {
    await expect(page.locator('.start-list-heat')).toHaveCount(2);
    await expect(page.locator('.start-list-heat').nth(0).locator('.start-list-racer')).toHaveCount(2);
    await expect(page.locator('.start-list-heat').nth(1).locator('.start-list-racer')).toHaveCount(4);
  });

  test('searching narrows the list, shows the hint and clearing restores it', async ({ page }) => {
    const first = (await page.locator('.start-list-racer').first().innerText()).trim();
    await page.locator('#competitorSearch').fill(first);
    await expect(page.locator('.start-list-heat')).toHaveCount(1);
    await expect(page.locator('.start-list-racer.chosen')).toHaveCount(1);
    await expect(page.locator('.start-list-filtered').first()).toBeVisible();
    await expect(page.locator('.start-list-next')).toBeVisible();
    await page.locator('.start-list-clear').click();
    await expect(page.locator('.start-list-heat')).toHaveCount(2);
    await expect(page.locator('.start-list-filtered')).toHaveCount(0);
  });

  test('a search without a match says so and offers to clear', async ({ page }) => {
    await page.locator('#competitorSearch').fill('zzzzqqqq');
    await expect(page.locator('.start-list-none')).toBeVisible();
    await page.locator('.start-list-none .clear-link').click();
    await expect(page.locator('.start-list-heat')).toHaveCount(2);
  });

  test('the back gesture clears the search instead of leaving the page', async ({ page }) => {
    await page.locator('#competitorSearch').fill('a');
    await expect(page.locator('.start-list-filtered, .start-list-none').first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/start-list/);
    await expect(page.locator('#competitorSearch')).toHaveValue('');
    await expect(page.locator('.start-list-heat')).toHaveCount(2);
  });

  test('the search is kept when coming back to the page', async ({ page }) => {
    const first = (await page.locator('.start-list-racer').first().innerText()).trim();
    await page.locator('#competitorSearch').fill(first);
    await page.reload();
    await expect(page.locator('#competitorSearch')).toHaveValue(first);
    await expect(page.locator('.start-list-heat')).toHaveCount(1);
  });

  test('a heat links to that heat on the dashboard', async ({ page }) => {
    await page.locator('.heat-link').nth(1).click();
    await expect(page).toHaveURL(/competitionId=e2e-lanes/);
    await expect(page.locator('.individual-heat-row').filter({ has: page.locator('.individual-lane-col:nth-child(4)') }).first()).toBeVisible();
  });
});
