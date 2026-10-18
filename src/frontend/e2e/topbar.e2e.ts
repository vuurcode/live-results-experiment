import { expect, test } from '@playwright/test';

test.describe('top bar', () => {
  test('the menu button and the competition picker share one row on every width', async ({ page }) => {
    for (const width of [320, 390, 767, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?competitionId=e2e-individual');
      const select = page.locator('#competitionSelect');
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await expect(select).toBeVisible();
      await expect(menu).toBeVisible();
      const [s, b] = await Promise.all([select.boundingBox(), menu.boundingBox()]);
      expect(Math.abs(s!.y + s!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(6);
      expect(b!.x + b!.width).toBeLessThanOrEqual(width);
    }
  });

  test('on a wide screen the competition picker is wider', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/?competitionId=e2e-individual');
    const box = await page.locator('#competitionSelect').boundingBox();
    expect(box!.width).toBeGreaterThan(700);
  });

  test('the menu opens with the live view, the start list, the ranking and the settings, and closes again', async ({ page }) => {
    await page.goto('/?competitionId=e2e-individual');
    const button = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    const menu = page.locator('#mainMenu');
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'Start list' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Ranking' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Live view' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('the menu links keep the competition and open their page', async ({ page }) => {
    await page.goto('/?competitionId=e2e-individual');
    for (const [name, path] of [['Start list', '/start-list'], ['Ranking', '/ranking'], ['Settings', '/settings']] as const) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('#mainMenu').getByRole('link', { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}\\?.*competitionId=e2e-individual`));
      await page.goBack();
      await expect(page.locator('app-heat-slider')).toBeVisible();
    }
  });

  test('the live view link in the menu and the logo link to the live view of the same competition', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/?competitionId=e2e-individual');
    await expect(page.locator('.topbar-logo-link')).toHaveAttribute('href', /^\/\?competitionId=e2e-individual/);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.locator('#mainMenu').getByRole('link', { name: 'Live view' })).toHaveAttribute('href', /^\/\?competitionId=e2e-individual/);
  });
});
