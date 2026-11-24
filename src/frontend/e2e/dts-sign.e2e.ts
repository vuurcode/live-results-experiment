import { expect, test } from '@playwright/test';
import { local, nameDevice, open, upload } from './dts-helpers';
import { sampleXml } from './dts-sample';

test.describe('dts sign page', () => {
  test.use({ locale: 'nl-NL' });

  test('arrow keys move through the search field and its matches like tab', async ({ page }) => {
    await upload(page);
    const find = page.getByLabel('Beennummer of naam');
    await find.fill('1');
    const matches = page.locator('button.match');
    expect(await matches.count()).toBeGreaterThan(1);
    await find.press('ArrowDown');
    await expect(matches.nth(0)).toBeFocused();
    await matches.nth(0).press('ArrowDown');
    await expect(matches.nth(1)).toBeFocused();
    await matches.nth(1).press('ArrowUp');
    await matches.nth(0).press('ArrowUp');
    await expect(find).toBeFocused();
  });

  test('lists partial numbers, says when nothing matches and suggests near misses', async ({ page }) => {
    await upload(page);
    const find = page.getByLabel('Beennummer of naam');
    const matches = page.locator('button.match');
    await find.fill('1');
    expect(await matches.count()).toBeGreaterThan(1);
    await expect(page.getByText('Bedoel je:')).toHaveCount(0);
    await find.fill('9999');
    await expect(matches).toHaveCount(0);
    await expect(page.getByText('Geen resultaten')).toBeVisible();
    await find.fill('Bakkr');
    await expect(page.getByText('Geen resultaten')).toBeVisible();
    await expect(page.getByText('Bedoel je:')).toBeVisible();
    await expect(matches.first()).toContainText('Bakker');
  });

  test('the front page offers signing and management', async ({ page }) => {
    await page.goto('/dts/');
    await expect(page.getByRole('heading', { name: 'Wat wil je doen?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Beheren' })).toHaveAttribute('href', '/dts-admin/');
    await page.getByRole('button', { name: 'Tekenen' }).click();
    await expect(page.getByText('Open de link of scan de QR-code')).toBeVisible();
  });

  test('the front page still lets a device with a list choose', async ({ page }) => {
    await upload(page);
    await page.goto('/dts/');
    await expect(page.getByRole('heading', { name: 'Wat wil je doen?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Beheren' })).toBeVisible();
    await page.getByRole('button', { name: 'Tekenen' }).click();
    await expect(page).toHaveURL(/\/dts\/\?s=|\/dts\/sign\?s=/);
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
  });

  test('removes a list from this device after asking', async ({ page }) => {
    await upload(page);
    await page.locator('details.sessions > summary').click();
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: /^Wissen/ }).click();
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: /^Wissen/ }).click();
    await expect(page.getByRole('heading', { name: 'Wat wil je doen?' })).toBeVisible();
    await page.getByRole('button', { name: 'Tekenen' }).click();
    await expect(page.getByText('Open de link of scan de QR-code')).toBeVisible();
  });

  test('uploads a file, signs a racer and shows it on the manage page', async ({ page, context }) => {
    const links = await upload(page);
    await expect(page.getByText('NO1', { exact: false }).first()).toBeVisible();
    await open(page, '11', /11\s+Aardappel/);
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Terug' }).click();
    await expect(page.getByText('1 van 2 getekend')).toBeVisible();

    const manage = await context.newPage();
    await manage.goto(links.manage.replace(/^https?:\/\/[^/]+/, ''));
    await expect(manage.getByText(/Laatste wijziging (zojuist|\d+ min geleden)/)).toBeVisible();
    await expect(manage.locator('.race', { hasText: 'NO1' }).locator('.count strong')).toHaveText(/^1 van /);
  });

  test('names the page in the tab, searches with the enter key and keeps the downloads at the bottom', async ({ page }) => {
    await page.goto('/dts-admin/new');
    await expect(page).toHaveTitle('Nieuwe tekenlijst · DTS Tekenlijst');
    await upload(page);
    await expect(page).toHaveTitle('DTS Tekenlijst');
    await page.getByLabel('Zoek op beennummer of naam').fill('11');
    await page.getByLabel('Zoek op beennummer of naam').press('Enter');
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
    await expect(page).toHaveTitle('Nummer 11 · DTS Tekenlijst');
    await page.getByRole('button', { name: 'Terug' }).click();
    const box = await page.locator('.downloads').boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(page.viewportSize()!.height * 0.6);
    await page.getByRole('button', { name: /Wissel naar English/ }).click();
    await expect(page).toHaveTitle('DTS Sign-in');
    await expect(page.locator('.lang span.on')).toHaveText('EN');
  });

  test('keeps several sessions side by side, each addressed by ?s= in its own tab', async ({ page, context }) => {
    await upload(page);
    await expect(page).toHaveURL(/\?s=[0-9a-f]+(#.*)?$/);
    const first = new URL(page.url()).searchParams.get('s')!;
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();

    const other = await context.newPage();
    await other.goto('/dts-admin/new');
    await other.setInputFiles('input[type=file]', {
      name: 'DTS_two.xml',
      mimeType: 'text/xml',
      buffer: Buffer.from(sampleXml()),
    });
    await expect(other.getByRole('heading', { name: /Klaar/ })).toBeVisible();
    const secondLink = local((await other.locator('.url').first().textContent())!.trim());
    const second = secondLink.split('#')[1].split('.')[0];
    expect(second).not.toBe(first);

    // a reload returns to the same session in each tab, without the keys in the address
    await page.goto(`/dts/sign?s=${first}`);
    await other.goto(secondLink);
    await nameDevice(other, 'Balie 2');
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
    await expect(other.getByLabel('Beennummer of naam')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('s')).toBe(first);
    expect(new URL(other.url()).searchParams.get('s')).toBe(second);

    // the first has the signed racer, the second does not
    await open(page, '11', /11\s+Aardappel/);
    await expect(page.locator('.tick')).toBeVisible();
    await open(other, '11', /11\s+Aardappel/);
    await expect(other.locator('.state')).toContainText('Nog niet getekend');

    // switching: the list names both and the link goes to the other one
    await page.goto(`/dts/sign?s=${first}`);
    const list = page.locator('.sessions');
    await list.locator('summary').click();
    await expect(list.locator('li')).toHaveCount(2);
    await list.locator('li').locator('button.session').click();
    await expect(page).toHaveURL(new RegExp(`\\?s=${second}`));
  });

  test('says so when the stored copy is gone', async ({ page }) => {
    await upload(page);
    const id = new URL(page.url()).searchParams.get('s')!;
    await expect(page.getByText('In sync met server')).toBeVisible();
    // cleared while the page is open: noticed and written back
    await page.evaluate(() => new Promise<void>((done) => {
      const req = indexedDB.open('dts-sign', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').clear();
        tx.oncomplete = () => done();
      };
    }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('alert').filter({ hasText: 'gewist terwijl de pagina openstond' })).toBeVisible();
    // cleared before the page was opened: the address names a list the device no longer has
    await page.evaluate(() => new Promise<void>((done) => {
      const req = indexedDB.open('dts-sign', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').clear();
        tx.oncomplete = () => done();
      };
    }));
    await page.goto(`/dts/sign?s=${id}`);
    await expect(page.getByRole('heading', { name: 'Deze tekenlijst staat niet op dit apparaat' })).toBeVisible();
  });

  test('does not warn a signer when a race starts far from now', async ({ page }) => {
    await upload(page, sampleXml({ firstStartInMinutes: 22030, secondStartInMinutes: 22090 }));
    await expect(page.getByText('de start is over')).toHaveCount(0);
  });

  test('shows when the list was last updated next to the sync status', async ({ page }) => {
    await upload(page);
    await expect(page.getByRole('status').filter({ hasText: /In sync met server · Laatst bijgewerkt \d\d:\d\d/ })).toBeVisible();
  });

  test('keeps the language in the address', async ({ page }) => {
    const links = await upload(page);
    await page.goto(`/dts/sign?lang=en#${links.sign.split('#')[1]}`);
    await page.getByRole('button', { name: /Switch to|Wissel naar/ }).click();
    await expect(page).toHaveURL(/lang=nl/);
  });

  test('signs straight away after the cutoff while the race is open', async ({ page }) => {
    await upload(page); // NO-2 starts in 20 minutes, its cutoff (30 minutes before the start) has passed
    await open(page, '21', /21\s+Citroen/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Terug' }).click();
    await open(page, '21', /21\s+Citroen/);
    await expect(page.locator('.tick')).toBeVisible();
    await expect(page.locator('.state')).toHaveText('Getekend');
  });

  test('removes a transponder by saving it empty, without a remove button', async ({ page }) => {
    await upload(page);
    await open(page, '12', /12\s+Bakker/);
    await page.getByRole('button', { name: 'Transponder 2' }).click();
    await expect(page.getByRole('button', { name: 'Verwijderen' })).toHaveCount(0);
    await page.getByLabel('Transponder 2').fill('ZZ99999');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('.badges')).toContainText('ZZ-99999');
    await page.getByRole('button', { name: 'Transponder 2' }).click();
    await page.getByLabel('Transponder 2').fill('');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('.badges')).not.toContainText('ZZ-99999');
  });

  test('opens a competitor from a row of the log', async ({ page }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Terug' }).click();
    await page.locator('.log summary').click();
    await page.locator('.log').getByRole('button', { name: /^11 Aardappel/ }).click();
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
  });

  test('warns, but does not block, on a cap number used twice in a race', async ({ page }) => {
    await upload(page);
    await open(page, '12', /12\s+Bakker/);
    await page.getByRole('button', { name: /^Beennummer/ }).click();
    await page.getByLabel('Beennummer', { exact: true }).fill('11');
    await expect(page.getByRole('alert')).toContainText('Nummer 11 is al in gebruik door Aardappel');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
    await expect(page.getByRole('alert').first()).toContainText('al in gebruik');
  });

  test('refuses a malformed transponder with a plain sentence', async ({ page }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Transponder 2' }).click();
    await page.getByLabel('Transponder 2').fill('12345');
    await expect(page.getByRole('alert')).toContainText('twee letters');
    await expect(page.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
  });

  test('keeps working offline and sends everything when the connection is back', async ({ page, context }) => {
    await upload(page);
    await context.setOffline(true);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText(/nog niet gesynchroniseerd|Geen verbinding/)).toBeVisible();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('In sync met server')).toBeVisible({ timeout: 20000 });
  });

  test('limits what is typed in the add form and adds the transponder hyphen', async ({ page }) => {
    await upload(page);
    await page.getByRole('button', { name: 'Nieuwe deelnemer' }).first().click();
    await page.getByLabel('Naam', { exact: true }).fill('  Esselink, Eva');
    await expect(page.getByLabel('Naam', { exact: true })).toHaveValue('Esselink, Eva');
    await page.getByLabel('Beennummer', { exact: true }).pressSequentially('x 12345');
    await expect(page.getByLabel('Beennummer', { exact: true })).toHaveValue('X123');
    await expect(page.getByLabel('Transponder 1')).toHaveAttribute('placeholder', 'AA-12345');
    await expect(page.getByLabel(/Transponder 2/)).toHaveAttribute('placeholder', 'AA-12345');
    await page.getByLabel('Transponder 1').pressSequentially('zz 99999999');
    await expect(page.getByLabel('Transponder 1')).toHaveValue('ZZ-99999');
    await expect(page.getByRole('button', { name: 'Alleen toevoegen' })).toBeEnabled();
    await page.getByRole('button', { name: 'Veld leegmaken' }).first().click();
    await expect(page.getByLabel('Transponder 1')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Alleen toevoegen' })).toBeEnabled();
    await page.getByLabel('Transponder 1').fill('zz9');
    await expect(page.getByRole('button', { name: 'Alleen toevoegen' })).toBeDisabled();
  });

  test('adds a racer without transponders and notes it', async ({ page }) => {
    await upload(page);
    await page.getByRole('button', { name: 'Nieuwe deelnemer' }).first().click();
    await page.getByLabel('Naam', { exact: true }).fill('Esselink, Eva');
    await page.getByLabel('Beennummer', { exact: true }).fill('x7');
    await page.getByRole('button', { name: 'Alleen toevoegen' }).click();
    await expect(page.getByText('Zonder transponder toegevoegd')).toBeVisible();
  });

  test('adds a racer with all fields in one form', async ({ page }) => {
    await upload(page);
    await page.getByRole('button', { name: 'Nieuwe deelnemer' }).first().click();
    await expect(page.getByRole('button', { name: 'Alleen toevoegen' })).toBeDisabled();
    await page.getByLabel('Naam', { exact: true }).fill('Esselink, Eva');
    await page.getByLabel('Beennummer', { exact: true }).fill('x5');
    await page.getByLabel('Transponder 1').fill('zz99999');
    await page.getByRole('button', { name: 'Toevoegen + tekenen' }).click();
    await expect(page.locator('.badge.cap .v')).toHaveText('X5');
    await expect(page.locator('.tick')).toBeVisible();
  });

  test('lets the manage page change the cutoff of a race', async ({ page, context }) => {
    const links = await upload(page);
    const manage = await context.newPage();
    await manage.goto(links.manage.replace(/^https?:\/\/[^/]+/, ''));
    const race = manage.locator('.race', { hasText: 'NO2' });
    await race.locator('.cutoffwrap summary').click();
    await race.getByLabel('Minuten voor de start').fill('10');
    await race.getByRole('button', { name: 'Opslaan' }).click();
    await expect(manage.getByText('Opgeslagen')).toBeVisible();
    await page.bringToFront();
    await page.reload();
    await open(page, '21', /21\s+Citroen/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('has no horizontal scroll at 320px and big targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await expect(page.getByRole('button', { name: 'Markeer als getekend' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const b of await page.locator('button.big').all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(63);
  });

  test('offers a signer no way to start a list and explains a device without one', async ({ page }) => {
    await page.goto(`/dts/sign?s=${'0'.repeat(32)}`);
    await expect(page.getByRole('heading', { name: 'Deze tekenlijst staat niet op dit apparaat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alle tekenlijsten' })).toHaveCount(0);
    await upload(page);
    await expect(page.getByRole('button', { name: 'Nieuwe tekenlijst' })).toHaveCount(0);
  });

  test('focuses the search field, names the competitors on the badges and fits a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    await upload(page);
    await expect(page.getByLabel('Beennummer of naam')).toBeFocused();
    const fold = page.locator('.race-fold', { hasText: 'NO1' });
    await expect(fold.locator('.numbers .num[data-state="signed"], .numbers .num[data-state="open"]').first().locator('.who')).toContainText(/\S/);
    await expect(fold.locator('.numbers .num', { hasText: '11' }).first()).toHaveAccessibleName(/^11 .*Aardappel/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const widths = await fold.locator('.numbers .num:not(.new)').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
    const width = (await page.locator('.dts').boundingBox())?.width ?? 0;
    expect(width).toBeGreaterThan(640);
  });

  test('splits the badge of a number that is signed and changed over its two states', async ({ page }) => {
    await upload(page);
    await open(page, '12', /12\s+Bakker/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Transponder 2' }).click();
    await page.getByLabel('Transponder 2').fill('ZZ99999');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await page.getByRole('button', { name: 'Terug' }).click();
    const badge = page.locator('.race-fold', { hasText: 'NO1' }).locator('.numbers .num', { hasText: '12' }).first();
    await expect(badge).toHaveAttribute('data-state', 'changed');
    await expect(badge).toHaveAttribute('data-also', 'signed');
    await expect(badge).toHaveCSS('background-image', /linear-gradient/);
    await expect(badge.locator('.mark')).toHaveText(['✎', '✓']);
  });

  test('shows a race overview with the numbers as status badges and returns to it from a racer', async ({ page }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Terug' }).click();
    const fold = page.locator('.race-fold', { hasText: 'NO1' });
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator('.numbers .num[data-state="signed"]')).toHaveText(/11/);
    await expect(fold.locator('.numbers .num[data-state="open"]').first()).toBeVisible();
    await fold.locator('.numbers .num[data-state="open"]').first().click();
    await page.getByRole('button', { name: 'Terug' }).click();
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
  });

  test('gives each screen its own address that survives a reload and the back button', async ({ page }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await expect(page).toHaveURL(/view=rider&rider=/);
    await page.reload();
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
    await page.goBack();
    await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
    await expect(page).not.toHaveURL(/view=/);
    await page.goForward();
    await expect(page.locator('.badge.cap .v')).toHaveText('11');
  });

  test('has no way to create or manage a list on the signers address', async ({ page }) => {
    const links = await upload(page);
    const id = links.sign.split('#')[1].split('.')[0];
    for (const path of ['/dts/', '/dts/new', `/dts/list?s=${id}`, `/dts/edit?s=${id}`]) {
      await page.goto(path);
      await expect(page.locator('input[type=file]'), path).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Tekenlijsten beheren' }), path).toHaveCount(0);
      await expect(page.locator('.race'), path).toHaveCount(0);
    }
  });
});
