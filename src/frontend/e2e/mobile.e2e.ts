import { expect, test, type Page } from '@playwright/test';
import { heatUrl } from './slider';

for (const width of [320, 390]) {
  test.describe(`mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 740 }, hasTouch: true });

    for (const competition of ['e2e-individual', 'e2e-mass']) {
      test(`${competition}: no horizontal page scroll, menu open`, async ({ page }) => {
        await page.goto(`/?competitionId=${competition}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await expect(page.locator('#mainMenu .menu-link').first()).toBeVisible();

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }

    test('the settings page has no horizontal page scroll', async ({ page }) => {
      await page.goto('/settings?competitionId=e2e-mass');
      await expect(page.locator('.setting-group').first()).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test('menu and settings controls are at least 24px (WCAG 2.5.8)', async ({ page }) => {
      await page.goto('/?competitionId=e2e-mass');
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.locator('#mainMenu .menu-link').first()).toBeVisible();
      const menuSmall = await page.evaluate(() =>
        [...document.querySelectorAll('#mainMenu button, #mainMenu a')]
          .map((e) => ({ n: e.id || e.className.toString(), r: e.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.width < 24 || x.r.height < 24))
          .map((x) => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
      );
      expect(menuSmall).toEqual([]);
      await page.goto('/settings?competitionId=e2e-mass');
      await expect(page.locator('.setting-group').first()).toBeVisible();
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main button, main input, main a, main select')]
          .map((e) => ({ n: e.id || e.className.toString(), r: e.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.width < 24 || x.r.height < 24))
          .map((x) => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
      );
      expect(small).toEqual([]);
    });
  });
}

test.describe('swiping between heats', () => {
  test.use({ viewport: { width: 390, height: 740 }, hasTouch: true });

  /** A finger stroke from one point to another, in steps over `ms` milliseconds. */
  async function swipe(page: Page, from: [number, number], to: [number, number], ms = 200) {
    const cdp = await page.context().newCDPSession(page);
    const steps = 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(ms / steps);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  const heat = (page: Page) => page.getByRole('slider');

  test('a quick horizontal swipe moves to the next and the previous heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await swipe(page, [340, 400], [60, 405]);
    await expect(heat(page)).not.toHaveAttribute('aria-valuetext', /Heat 2$/);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
    await swipe(page, [60, 400], [340, 395]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
  });

  test('the cards slide in from the side the swipe came from', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    const card = page.locator('.step-view .individual-competitor-card').first();
    await swipe(page, [340, 400], [60, 405]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
    await expect(page.locator('.step-view.slide-from-right')).toHaveCount(1);
    await expect(card).toHaveCSS('animation-name', /slideFromRight$/);
    await swipe(page, [60, 400], [340, 395]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
    await expect(page.locator('.step-view.slide-from-left')).toHaveCount(1);
    await expect(card).toHaveCSS('animation-name', /slideFromLeft$/);
  });

  test('the heat follows the finger while it drags and springs back when released short', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 240, y: 402 }] });
    await expect(page.locator('.step-view').first()).toHaveCSS('transform', /matrix/);
    await expect(page.locator('.swipe-target')).toContainText('Heat 3');
    await expect(page.locator('.swipe-target-arrow')).toHaveText('→');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.step-view').first()).toHaveCSS('transform', 'none');
    await expect(page.locator('.swipe-target')).toHaveCount(0);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
  });

  test('dragging past the first heat marks Start, past the last End', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 1$/, { timeout: 15_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 260, y: 402 }] });
    const mark = page.locator('.swipe-target');
    await expect(mark).toContainText('Start');
    await expect(page.locator('.swipe-target-arrow')).toHaveText('←');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mark).toHaveCount(0);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 1$/);
  });

  test('a short, a diagonal and a slow stroke leave the heat alone', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await swipe(page, [250, 400], [180, 400]);
    await swipe(page, [340, 300], [120, 460]);
    await swipe(page, [340, 400], [60, 400], 1500);
    await page.waitForTimeout(500);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
  });
});
