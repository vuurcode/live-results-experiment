import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { local, open, upload } from './dts-helpers';
import { sampleXml } from './dts-sample';

// Same rule set as the dashboard's accessibility spec.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function scan(page: Page, what: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, what).toEqual([]);
}

test.describe('dts accessibility', () => {
  test.use({ locale: 'nl-NL' });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sign screens and the manage page have no axe violations (${scheme})`, async ({ page, context }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto('/dts/sign?new=1');
      await scan(page, 'start');
      const links = await upload(page);
      await scan(page, 'home');
      await scan(page, 'home with the races expanded');
      await open(page, '12', /12\s+Bakker/);
      await scan(page, 'rider');
      await page.getByRole('button', { name: /^Beennummer/ }).click();
      await page.getByLabel('Beennummer', { exact: true }).fill('11');
      await scan(page, 'edit with a warning');
      await page.getByRole('button', { name: 'Terug' }).click();
      await scan(page, 'rider with badges');
      await page.getByRole('button', { name: 'Terug' }).click();
      const share = new URL(page.url());
      share.searchParams.set('view', 'share');
      await page.goto(share.toString());
      await scan(page, 'share with the QR code');

      const manage = await context.newPage();
      await manage.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await manage.setViewportSize({ width: 1440, height: 900 });
      await manage.goto(local(links.manage));
      await expect(manage.locator('.race').first()).toBeVisible();
      await scan(manage, 'manage');
      await manage.getByRole('button', { name: 'Ongetekend' }).click();
      await scan(manage, 'manage with a filter pressed');

      await page.bringToFront();
      await page.goto('/dts/');
      await expect(page.getByRole('heading', { name: 'Tekenlijsten beheren' })).toBeVisible();
      await expect(page.locator('.sessions > li').first()).toBeVisible();
      await scan(page, 'admin page');

      await page.locator('.sessions > li').first().getByRole('button', { name: 'Details' }).click();
      await expect(page).toHaveURL(/\/dts\/list\?s=/);
      await expect(page.locator('a.numlink').first()).toBeVisible();
      await scan(page, 'admin list with the numbers');
      const popup = page.waitForEvent('popup');
      await page.locator('a.numlink').first().click();
      const details = await popup;
      await details.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await expect(details.locator('.state').first()).toBeVisible();
      await scan(details, 'admin competitor details');
    });

    test(`the pages stay accessible with races far from now and on a narrow window (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 320, height: 640 });
      const links = await upload(page, sampleXml({ firstStartInMinutes: 22030, secondStartInMinutes: 22090 }));
      await scan(page, 'home with warnings, narrow');
      await page.getByRole('button', { name: 'Nieuwe deelnemer' }).first().click();
      await scan(page, 'add a racer, narrow');
      await page.goto(`/dts/sign?s=${'0'.repeat(32)}`);
      await scan(page, 'missing session');
      await page.setViewportSize({ width: 600, height: 800 });
      await page.goto(local(links.manage));
      await expect(page.locator('.race').first()).toBeVisible();
      await scan(page, 'manage with alerts, narrow');
    });
  }
});
