import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test.describe(`mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 740 }, hasTouch: true });

    for (const competition of ['e2e-individual', 'e2e-mass']) {
      test(`${competition}: no horizontal page scroll, menu open`, async ({ page }) => {
        await page.goto(`/?competitionId=${competition}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await expect(page.locator('#mainMenu .setting-group').first()).toBeVisible();

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }

    test('menu and settings controls are at least 24px (WCAG 2.5.8)', async ({ page }) => {
      await page.goto('/?competitionId=e2e-mass');
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.locator('#mainMenu .setting-group').first()).toBeVisible();
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('header button, #mainMenu button, #mainMenu input, #mainMenu a, #mainMenu select')]
          .map((e) => ({ n: e.id || e.className.toString(), r: e.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.width < 24 || x.r.height < 24))
          .map((x) => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
      );
      expect(small).toEqual([]);
    });
  });
}
