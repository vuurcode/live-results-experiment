import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { local, open, upload } from './dts-helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const TABLETS = [
  { name: 'tablet portrait', width: 768, height: 1024 },
  { name: 'tablet landscape', width: 1024, height: 768 },
  { name: 'large tablet portrait', width: 834, height: 1194 },
  { name: 'android tablet', width: 800, height: 1280 },
];

async function noOverflow(page: Page, what: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${what} scrolls horizontally`).toBeLessThanOrEqual(0);
}

async function axe(page: Page, what: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test.describe('dts on tablets', () => {
  test.use({ locale: 'nl-NL' });

  for (const size of TABLETS) {
    test(`fits and stays accessible on a ${size.name} (${size.width}x${size.height})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const links = await upload(page);
      await expect(page.locator('.numbers .num').first()).toBeVisible();
      await noOverflow(page, 'sign overview');
      await axe(page, 'sign overview');
      await open(page, '12', /12\s+Bakker/);
      await noOverflow(page, 'rider');
      await axe(page, 'rider');
      await page.goto(local(links.manage));
      await expect(page.locator('.race').first()).toBeVisible();
      await noOverflow(page, 'manage');
      await axe(page, 'manage');
      for (const target of await page.locator('button.num, .legend .num').all()) {
        const box = await target.boundingBox();
        if (box) expect(Math.min(box.width, box.height), 'touch target').toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('dts survives a lost connection and a suspended phone', () => {
  test.use({ locale: 'nl-NL' });

  test('keeps a signature made offline over a lock and sends it when the phone wakes up', async ({ page, context }) => {
    const links = await upload(page);
    await context.setOffline(true);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText(/nog niet gesynchroniseerd|Geen verbinding/)).toBeVisible();

    // the app shell is stored on the first visit already, so a reload without connection finds it
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('dts-shell-')) && !!(await caches.match('/dts-shell')))).toBe(true);

    // the phone locks: the page is hidden, then shown again with the copy on the device still holding the signature
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });
    await expect(page.locator('.tick')).toBeVisible();

    // waking up: the connection is back and the page becomes visible again
    await context.setOffline(false);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('In sync met server')).toBeVisible({ timeout: 20000 });

    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.race', { hasText: 'NO1' }).locator('.count strong')).toHaveText(/^1 van /);
  });

  test('survives a reload without connection, with a pending signature, and sends it afterwards', async ({ page, context }) => {
    const links = await upload(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // the first visit loads before the worker controls the page; a second load puts every file in the cache
    await page.reload();
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
    await context.setOffline(true);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.locator('.tick')).toBeVisible();

    // a refresh and a visit to the front page without connection both find the app and the copy on the device
    await page.reload();
    await expect(page.locator('.tick')).toBeVisible();
    await page.goto('/dts/');
    await expect(page.getByRole('button', { name: 'Tekenen' })).toBeVisible();

    await context.setOffline(false);
    await page.goto(local(links.sign));
    await expect(page.getByText('In sync met server')).toBeVisible({ timeout: 20000 });
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.race', { hasText: 'NO1' }).locator('.count strong')).toHaveText(/^1 van /);
  });

  test('does not poll the host while the page is hidden more than every 30 seconds', async ({ page }) => {
    await upload(page);
    await page.clock.install();
    const calls: number[] = [];
    await page.route('**/dts-api/sessions/**', async (route) => {
      calls.push(Date.now());
      await route.continue();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(10 * 60 * 1000);
    expect(calls.length, 'requests in ten minutes hidden').toBeLessThanOrEqual(22);
  });
});
