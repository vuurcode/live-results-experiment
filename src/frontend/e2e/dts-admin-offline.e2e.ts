import { expect, test } from '@playwright/test';
import { local, upload } from './dts-helpers';

test.describe('dts admin without connection', () => {
  test.use({ locale: 'nl-NL' });

  test('keeps a change made offline over a reload and sends it when the connection is back', async ({ page, context }) => {
    const links = await upload(page);
    await page.goto(local(links.manage));
    const race = page.locator('.race', { hasText: 'NO1' });
    await expect(race.getByRole('button', { name: 'Inschrijving sluiten' })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    // the first visit loads before the worker controls the page: reload once so the shell and the data are on the device
    await page.reload();
    await expect(race.getByRole('button', { name: 'Inschrijving sluiten' })).toBeVisible();

    await context.setOffline(true);
    await race.getByRole('button', { name: 'Inschrijving sluiten' }).click();
    await expect(race.getByRole('button', { name: 'Heropenen' })).toBeVisible();
    await expect(page.getByText(/Wijzigingen in de wachtrij: 1/)).toBeVisible();

    // a reload without connection still opens the page, from the copy, with the change shown
    await page.reload();
    await expect(race.getByRole('button', { name: 'Heropenen' })).toBeVisible();
    await expect(page.getByText(/Wijzigingen in de wachtrij: 1/)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/Wijzigingen in de wachtrij/)).toHaveCount(0, { timeout: 30000 });
    const id = new URL(page.url()).searchParams.get('s')!;
    const state = await (await page.request.get(`/dts-api/admin/sessions/${id}`)).json();
    expect(state.races.some((r: { closed?: boolean }) => r.closed)).toBe(true);
  });

  test('opens the list of lists and a list from the copy on this device', async ({ page, context }) => {
    const links = await upload(page);
    await page.goto('/dts-admin/');
    await expect(page.locator('.sessions > li').first()).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('.sessions > li').first()).toBeVisible();
    // give the background copy of every list a moment
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.sessions > li').first()).toBeVisible();
    await expect(page.getByText('Geen verbinding: je ziet de laatst opgeslagen gegevens.')).toBeVisible();
    await page.goto(local(links.manage));
    await expect(page.locator('.race').first()).toBeVisible();
  });
});
