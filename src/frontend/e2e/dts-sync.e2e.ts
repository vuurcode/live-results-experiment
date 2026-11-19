import { expect, test } from '@playwright/test';
import { local, open, upload } from './dts-helpers';

test.describe('dts sync, restore and install', () => {
  test.use({ locale: 'nl-NL' });

  test('shows a QR code of the sign link and resumes without the link', async ({ page }) => {
    await upload(page);
    const share = new URL(page.url());
    share.searchParams.set('view', 'share');
    await page.goto(share.toString());
    await expect(page.getByRole('img', { name: /QR-code/ })).toBeVisible();
    await page.goto('/dts/sign');
    await expect(page.getByRole('heading', { name: 'DTS Tekenlijst' })).toBeVisible();
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
  });

  test('offers the manifest and registers the service worker', async ({ page }) => {
    await upload(page);
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/dts.webmanifest');
    const manifest = await page.request.get('/dts.webmanifest');
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).start_url).toBe('/dts/sign');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/dts/'))?.scope ?? '')).toContain('/dts/');
  });

  test('recreates the session on the host from the device copy', async ({ page, context }) => {
    const links = await upload(page);
    const [id, key] = local(links.sign).split('#')[1].split('.');
    const gone = await page.request.delete(`/dts-api/sessions/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    expect(gone.status()).toBeLessThan(300);

    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible({ timeout: 20000 });

    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.race', { hasText: 'NO1' }).locator('.count strong')).toHaveText(/^1 van /);
  });

  test('tells a signer when another device changed the racer on screen', async ({ page, browser }) => {
    const links = await upload(page);
    await open(page, '12', /12\s+Bakker/);

    const other = await (await browser.newContext({ locale: 'nl-NL' })).newPage();
    await other.goto(local(links.sign));
    await other.getByLabel('Je naam').fill('Balie 2');
    await other.getByRole('button', { name: 'Verder' }).click();
    await open(other, '12', /12\s+Bakker/);
    await other.getByRole('button', { name: /^Beennummer/ }).click();
    await other.getByLabel('Beennummer', { exact: true }).fill('77');
    await other.getByRole('button', { name: 'Opslaan' }).click();
    await expect(other.locator('.badge.cap .v')).toHaveText('77');

    await expect(page.getByRole('alert').filter({ hasText: 'beennummer gewijzigd naar 77' })).toBeVisible({ timeout: 30000 });
  });

  test('asks a scanning signer for a name, suggests the last one and uses it for the changes', async ({ page, browser }) => {
    const links = await upload(page);
    const context = await browser.newContext({ locale: 'nl-NL' });
    const first = await context.newPage();
    await first.goto(local(links.sign));
    await expect(first.getByRole('heading', { name: 'Wie ben jij, de inschrijver?' })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Verder' })).toBeDisabled();
    await first.getByLabel('Je naam').fill('Balie 3');
    await first.getByRole('button', { name: 'Verder' }).click();
    await open(first, '11', /11\s+Aardappel/);
    await first.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(first.getByText('In sync met server')).toBeVisible();

    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.panels').getByText('Balie 3').first()).toBeVisible();

    const creator = await (await browser.newContext({ locale: 'nl-NL' })).newPage();
    const second = await upload(creator);
    const other = await context.newPage();
    await other.goto(local(second.sign));
    await expect(other.getByLabel('Je naam')).toHaveValue('Balie 3');
    await other.getByLabel('Je naam').fill('Balie 4');
    await other.getByRole('button', { name: 'Verder' }).click();
    await expect(other.getByLabel('Beennummer of naam')).toBeVisible();
  });
});
