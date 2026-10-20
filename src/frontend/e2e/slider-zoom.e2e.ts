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

  test('the Live and You pills never cover each other, near or far apart', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const heat of [13, 14, 18]) {
      await page.goto(heatUrl(COMPETITION, 'dist-500', heat));
      await expect(page.locator('.you-pill')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      const [live, you] = await Promise.all(['.live-pill', '.you-pill'].map((selector) => page.locator(selector).boundingBox()));
      const apart = live!.x + live!.width <= you!.x || you!.x + you!.width <= live!.x || live!.y + live!.height <= you!.y || you!.y + you!.height <= live!.y;
      expect(apart, `heat ${heat}`).toBe(true);
    }
  });

  test('on a Pixel 7a the pills stay on screen and the page leaves just the room the slider takes', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    for (const heat of [11, 3]) {
      await page.goto(heatUrl(COMPETITION, 'dist-500', heat));
      await expect(page.locator('.you-pill')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      const you = await page.locator('.you-pill').boundingBox();
      expect(you!.y + you!.height, `heat ${heat}`).toBeLessThanOrEqual(915);
    }
    const room = await page.evaluate(() => ({
      padding: parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom),
      slider: document.querySelector('.heat-slider-host')!.getBoundingClientRect().height,
    }));
    expect(room.padding).toBeGreaterThanOrEqual(room.slider);
    expect(room.padding).toBeLessThanOrEqual(room.slider + 20);
  });

  test('on a narrow screen the slider is compact, full size while the viewer moves it by hand and for a moment after', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`/?competitionId=${COMPETITION}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    const host = page.locator('.heat-slider-host');
    const mainPadding = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom));
    await expect(page.locator('.heat-slider.compact')).toBeVisible();
    await expect(page.locator('.live-pill')).toBeHidden();
    const compact = (await host.boundingBox())!.height;
    // the live heat moving on by itself leaves it compact
    await page.waitForTimeout(3500);
    await expect(page.locator('.heat-slider.compact')).toBeVisible();
    expect(await mainPadding()).toBeLessThanOrEqual(130 + 20); // the compact slider takes spare room, up to the size of the full one
    const scrolls = () => page.evaluate(() => (() => { const main = document.querySelector('main')!; return main.scrollHeight > main.clientHeight || document.documentElement.scrollHeight > innerHeight; })());
    expect(await scrolls()).toBe(false);
    await slider(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.heat-slider.compact')).toHaveCount(0);
    await expect(page.locator('.live-pill')).toBeVisible();
    // the compact slider may have taken spare room already: the full one is at least as tall
    await expect.poll(async () => (await host.boundingBox())!.height).toBeGreaterThanOrEqual(compact);
    const full = (await host.boundingBox())!.height;
    expect(await mainPadding()).toBeGreaterThanOrEqual(full);
    // left alone for a moment, it folds back
    await expect(page.locator('.heat-slider.compact')).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await host.boundingBox())!.height).toBeLessThanOrEqual(full + 1);
    expect(await scrolls()).toBe(false);
  });

  test('the You pill stays on screen while the slider is compact', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`/?competitionId=${COMPETITION}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await slider(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.you-pill')).toBeVisible();
    await expect(page.locator('.heat-slider.compact')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    const you = (await page.locator('.you-pill').boundingBox())!;
    const host = (await page.locator('.heat-slider-host').boundingBox())!;
    expect(you.y + you.height).toBeLessThanOrEqual(Math.min(915, host.y + host.height));
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

  test('the compact slider takes spare room at the bottom, never more than the full slider', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 1400 });
    await page.goto(`/?competitionId=${COMPETITION}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    const host = page.locator('.heat-slider-host');
    await expect(page.locator('.heat-slider.compact')).toBeVisible({ timeout: 8000 });
    const height = async () => (await host.boundingBox())!.height;
    await expect.poll(height).toBeGreaterThan(110);
    await slider(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.heat-slider.compact')).toHaveCount(0);
    await page.waitForTimeout(600);
    const full = await height();
    await expect(page.locator('.heat-slider.compact')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);
    expect(await height()).toBeLessThanOrEqual(full + 2);
  });

  test('the heading texts shrink only when the heats leave no room', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 1400 });
    await page.goto(heatUrl(COMPETITION, 'dist-500', 3));
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.individual-competitor-card').first()).toBeVisible();
    await expect(page.locator('app-dashboard[data-tight]')).toHaveCount(0);
    await page.setViewportSize({ width: 412, height: 420 });
    await expect(page.locator('app-dashboard[data-tight]')).toHaveCount(1);
  });

  test('the heats scroll in the part under the top bar, never beneath it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto(heatUrl(COMPETITION, 'dist-500', 3));
    await expect(page.locator('.individual-competitor-card').first()).toBeVisible({ timeout: 15_000 });
    const frame = await page.evaluate(() => ({
      barBottom: document.querySelector('.topbar')!.getBoundingClientRect().bottom,
      mainTop: document.querySelector('main')!.getBoundingClientRect().top,
      pageScrolls: document.documentElement.scrollHeight > innerHeight,
    }));
    expect(frame.mainTop).toBeGreaterThanOrEqual(frame.barBottom - 1);
    expect(frame.pageScrolls).toBe(false);
  });
});
