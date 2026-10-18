import { expect, test } from '@playwright/test';
import { heatUrl, slider } from './slider';

test.describe('heat slider', () => {
  test('Home and End move to the first and last heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await slider(page).focus();
    await page.keyboard.press('Home');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 1$/);
    await page.keyboard.press('End');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
  });

  test('the live pill brings a pinned view back to the live heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    const pill = page.locator('.live-pill');
    await expect(pill).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
  });

  test('the position is announced as the heat label of the step', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 3));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/, { timeout: 15_000 });
  });

  test('a short event keeps its heat ticks on a narrow screen, since it needs no zoom', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/?competitionId=e2e-pairs');
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.mark-tick').count()).toBeGreaterThan(0);
  });

  test('the slider fits the screen without horizontal scroll', async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?competitionId=e2e-pairs');
      await expect(slider(page)).toBeVisible({ timeout: 15_000 });
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw).toBeLessThanOrEqual(cw);
    }
  });
});
