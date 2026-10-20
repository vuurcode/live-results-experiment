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
    await expect(card).toHaveCSS('animation-name', /slideFromRight2?$/);
    await swipe(page, [60, 400], [340, 395]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
    await expect(page.locator('.step-view.slide-from-left')).toHaveCount(1);
    await expect(card).toHaveCSS('animation-name', /slideFromLeft2?$/);
  });

  test('the heat landed on stays named in the middle for a moment', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await swipe(page, [340, 400], [60, 405]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
    const mark = page.locator('.heat-mark-center');
    await expect(mark).toContainText('Heat 3');
    await expect(mark.locator('.heat-mark-eye, .heat-mark-dot')).toBeVisible(); // the dot instead of the eye on the live heat
    const sideBox = (await page.locator('.heat-mark:not(.heat-mark-center)').first().boundingBox())!;
    expect((await mark.boundingBox())!.height).toBeCloseTo(sideBox.height, 0);
    const sides = page.locator('.heat-mark:not(.heat-mark-center)');
    await expect(sides).toHaveCount(2);
    await expect(sides.first()).toContainText('Heat 2');
    await expect(sides.nth(1)).toContainText(/Heat 4|End/);
    await expect(page.locator('.heat-mark')).toHaveCount(0, { timeout: 3000 });
  });

  test('the mark of the live heat has the live border, the marks of the other heats do not', async ({ page }) => {
    await page.goto(heatUrl('e2e-long', 'dist-500', 11));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 11$/, { timeout: 15_000 });
    await swipe(page, [340, 400], [60, 405]);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 12$/);
    await expect(page.locator('.heat-mark-center')).toHaveClass(/heat-mark-live/);
    await expect(page.locator('.heat-mark:not(.heat-mark-center)').first()).not.toHaveClass(/heat-mark-live/);
  });

  test('quick swipes in a row each move a heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 1$/, { timeout: 15_000 });
    await swipe(page, [340, 400], [230, 402], 60);
    await swipe(page, [340, 400], [230, 402], 60);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
    await swipe(page, [230, 400], [340, 398], 60);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
  });

  test('a swipe that starts on a name link still moves the heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-individual', 'dist-500', 1));
    const link = page.locator('a.individual-comp-name-line').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const box = (await link.boundingBox())!;
    const before = await heat(page).getAttribute('aria-valuetext');
    await swipe(page, [box.x + box.width / 2 - 40, box.y + box.height / 2], [box.x + box.width / 2 + 120, box.y + box.height / 2], 120);
    await expect(heat(page)).not.toHaveAttribute('aria-valuetext', before!);
  });

  test('the heat follows the finger while it drags and springs back when released short', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 240, y: 402 }] });
    await page.waitForTimeout(500); // slow, so the release is no flick
    await expect(page.locator('.step-view').first()).toHaveCSS('transform', /matrix/);
    await expect(page.locator('.heat-mark:not(.heat-mark-center)')).toContainText('Heat 3');
    await expect(page.locator('.heat-mark:not(.heat-mark-center) .heat-mark-arrow')).toHaveText('→');
    await expect(page.locator('.heat-mark-center')).toContainText('Heat 2');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.step-view').first()).toHaveCSS('transform', 'none');
    await expect(page.locator('.heat-mark')).toHaveCount(0);
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
  });

  test('sliding the slider names the heat it is on, and the heats around it', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    const box = (await heat(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 });
    const middle = page.locator('.heat-mark-center');
    await expect(middle).toContainText(/Heat \d+/);
    const here = (await middle.innerText()).trim();
    const sides = page.locator('.heat-mark:not(.heat-mark-center)');
    await expect(sides).toHaveCount(2);
    for (const side of await sides.all()) expect(await side.innerText()).not.toContain(here);
    await page.mouse.up();
    await expect(page.locator('.heat-mark')).toHaveCount(0, { timeout: 3000 });
  });

  test('the marks stay below the top bar and on screen when the page is scrolled', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await page.evaluate(() => document.querySelector('main')!.scrollTo(0, 1e6));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 240, y: 402 }] });
    const box = (await page.locator('.heat-mark-center').boundingBox())!;
    const bar = (await page.locator('.topbar').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });

  test('dragging past the first heat marks Start, past the last End', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    await expect(heat(page)).toHaveAttribute('aria-valuetext', /Heat 1$/, { timeout: 15_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 260, y: 402 }] });
    const mark = page.locator('.heat-mark:not(.heat-mark-center)');
    await expect(mark).toContainText('Start');
    await expect(page.locator('.heat-mark:not(.heat-mark-center) .heat-mark-arrow')).toHaveText('✕');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.heat-mark')).toHaveCount(0);
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
