import { expect, test } from '@playwright/test';
import { heatUrl, slider } from './slider';

// A 20-heat event with heats 1-12 timed; its second sample corrects a lap of heat 3 after heat 12 has started.
const COMPETITION = 'e2e-long';

test.describe('a long event', () => {
  test('a late change to an earlier heat does not take the live heat back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(heatUrl(COMPETITION, 'dist-500', 3));
    // the corrected lap has arrived once heat 3 shows it
    await expect(page.getByText(/10\.7/).first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.live-pill').click();
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 12$/);
    await expect(page.locator('.live-pill')).toHaveAttribute('aria-pressed', 'true');
  });

  test('on a narrow screen the zoomed bar is only drawn and the overview below it takes the gestures', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/?competitionId=${COMPETITION}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    const box = (await slider(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 50);
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.heat-slider.zoomed')).toBeVisible();
    const minimap = page.locator('.minimap');
    await expect(minimap).toBeVisible();
    await expect(slider(page)).toHaveCSS('pointer-events', 'none');
    const bar = (await page.locator('.bar').boundingBox())!;
    const mini = (await minimap.boundingBox())!;
    expect(mini.y).toBeGreaterThan(bar.y + bar.height);
    expect(mini.y + mini.height).toBeLessThanOrEqual(800);
    // a press on the overview moves the thumb over the whole event
    const before = await slider(page).getAttribute('aria-valuetext');
    await page.mouse.move(mini.x + mini.width * 0.9, mini.y + mini.height / 2);
    await page.mouse.down();
    await expect(slider(page)).not.toHaveAttribute('aria-valuetext', before!);
    await page.mouse.up();
    await expect(slider(page)).not.toHaveAttribute('aria-valuetext', before!);
  });
});
