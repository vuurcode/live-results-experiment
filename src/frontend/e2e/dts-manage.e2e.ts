import { sampleXml } from './dts-sample';
import { expect, test, type Download } from '@playwright/test';
import { local, open, upload } from './dts-helpers';

test.describe('dts manage page', () => {
  test.use({ locale: 'nl-NL' });

  test('refuses a link with a wrong key', async ({ page }) => {
    await page.goto('/dts-admin/list?s=0123456789abcdef0123456789abcdef');
    await expect(page.getByText('Deze link werkt niet')).toBeVisible();
  });

  test('refuses a cutoff change with the sign key', async ({ page }) => {
    const links = await upload(page);
    const [id, key] = local(links.sign).split('#')[1].split('.');
    const answer = await page.request.put(`/dts-api/sessions/${id}/cutoff`, {
      headers: { Authorization: `Bearer ${key}` },
      data: { race: '3', minutes: 5 },
    });
    expect(answer.status()).toBe(404);
  });

  test('downloads one race and the whole file with the signed state', async ({ page, context }) => {
    const links = await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();

    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.race', { hasText: 'NO1' }).locator('.count strong')).toHaveText(/^1 van /);

    await expect(manage.getByRole('button', { name: /\(Alles\)/ })).toHaveCount(0);

    // the downloads sit in the next steps, which appear when the race is closed
    const race = manage.locator('.race', { hasText: 'NO1' });
    await race.getByRole('button', { name: 'Inschrijving sluiten' }).click();
    await race.getByRole('button', { name: /^Uitklappen/ }).click();
    const [mds] = await Promise.all([manage.waitForEvent('download'), manage.getByRole('button', { name: /^MDS-tekenlijst .*NO1$/ }).click()]);
    expect(mds.suggestedFilename()).toMatch(/_tekenlijst\.xml$/);
    const tekenlijst = await (await import('node:fs/promises')).readFile(await mds.path(), 'utf8');
    expect(tekenlijst).toContain('<Tekenlijst_Deelname>');
    expect(tekenlijst).toContain('<Getekend>1</Getekend>');
    expect(tekenlijst).toContain('<Transponder1LowBat>0</Transponder1LowBat>');
    expect(tekenlijst).not.toContain('<ShowNr>');
  });

  test('lists the signing device and stacks the races, each across the full width', async ({ page, context }) => {
    const links = await upload(page);
    const manage = await context.newPage();
    await manage.setViewportSize({ width: 1600, height: 900 });
    await manage.goto(local(links.manage));
    const races = manage.locator('.race');
    await expect(races).toHaveCount(2);
    await expect(manage.getByRole('heading', { name: 'Tekenapparaten' })).toBeVisible();
    const [a, b] = await Promise.all([races.nth(0).boundingBox(), races.nth(1).boundingBox()]);
    expect(a?.x).toBe(b?.x);
    expect((a?.y ?? 0) + (a?.height ?? 0)).toBeLessThanOrEqual(b?.y ?? 0);
  });

  test('shows numbers with names, green when signed, purple when changed and yellow with a note', async ({ page, context }) => {
    const links = await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    await page.getByRole('button', { name: 'Terug' }).click();
    await open(page, '12', /12\s+Bakker/);
    await page.getByRole('button', { name: 'Transponder 2' }).click();
    await page.getByLabel('Transponder 2').fill('ZZ99999');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();

    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    const race = manage.locator('.race', { hasText: 'NO1' });
    await expect(race.locator('.num[data-state="signed"]')).toHaveText(/11/);
    await expect(race.locator('.num[data-state="changed"]')).toHaveText(/12/);
    await expect(race.locator('.num[data-state="signed"] .who')).toHaveText(/Aardappel/);
    await expect(race.locator('.num[data-state="changed"] .who')).toHaveText(/Bakker/);
    const colour = (state: string) => race.locator(`.num[data-state="${state}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const signed = await colour('signed');
    const changed = await colour('changed');
    const id = new URL(manage.url()).searchParams.get('s')!;
    const st = await (await manage.request.get(`/dts-api/admin/sessions/${id}`)).json();
    const entry = st.races.flatMap((r: { entries: { id: string; cap: string }[] }) => r.entries).find((e: { cap: string }) => e.cap === '11').id;
    const noted = await manage.request.post(`/dts-api/admin/sessions/${id}/notes`, {
      data: { id: 'aabbccddeeff0011', kind: 'add', entry, level: 'warning', text: 'Nog betalen' },
    });
    expect(noted.status()).toBe(200);
    await expect(race.locator('.num[data-state="note"]')).toHaveText(/11/, { timeout: 20000 });
    // the colour fades to the new state, so it is read until it has settled
    await expect.poll(async () => new Set([signed, changed, await colour('note')]).size).toBe(3);
  });

  test('filters the numbers by status with the legend buttons', async ({ page, context }) => {
    const links = await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    const nums = manage.locator('.numbers .num');
    const all = await nums.count();
    await manage.getByRole('button', { name: 'Getekend', exact: true }).click();
    await expect(manage.getByRole('button', { name: 'Getekend', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(nums).toHaveCount(1);
    await manage.getByRole('button', { name: 'Getekend', exact: true }).click();
    await expect(nums).toHaveCount(all);
    await manage.getByRole('button', { name: 'Ongetekend' }).click();
    await expect(nums).toHaveCount(all - 1);
  });

  test('shows a tooltip at once on hover', async ({ page, context }) => {
    const links = await upload(page);
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await manage.getByRole('button', { name: /NL \/ EN/ }).hover();
    await expect(manage.getByText('Taal: Nederlands', { exact: false }).first()).toBeVisible({ timeout: 300 });
  });

  test('flags a race that starts far from now', async ({ page, context }) => {
    const links = await upload(page, sampleXml({ firstStartInMinutes: 22030, secondStartInMinutes: 22090 }));
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.locator('.banner.warn').filter({ hasText: 'de start is over' })).toHaveCount(2);
  });

  test('says how long ago a race started when the file is from the past', async ({ page, context }) => {
    const links = await upload(page, sampleXml({ firstStartInMinutes: -4000, secondStartInMinutes: -3990 }));
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    const notices = manage.locator('.banner.warn').filter({ hasText: /dagen geleden/ });
    await expect(notices).toHaveCount(2);
    await notices.first().getByRole('button', { name: 'Sluiten' }).click();
    await expect(notices).toHaveCount(1);
    await manage.reload();
    await expect(notices).toHaveCount(1);
  });

  test('lists the created sessions on /dts and deletes one for good', async ({ page }) => {
    await upload(page);
    const id = new URL(page.url()).searchParams.get('s')!;
    await page.goto('/dts-admin/');
    await expect(page.getByRole('heading', { name: 'Tekenlijsten beheren' })).toBeVisible();
    const row = page.locator('.sessions > li').filter({ hasText: 'NO1' }).first();
    await expect(row).toBeVisible();
    const before = await page.locator('.sessions > li').count();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.locator('.sessions > li')).toHaveCount(before - 1);

    await page.goto(`/dts/sign?s=${id}`);
    await expect(page.getByText('Alle gegevens ervan zijn ook van dit toestel gewist')).toBeVisible();
    // nothing of the list stays in this device's storage
    const stored = await page.evaluate(
      () => new Promise<string[]>((resolve) => {
        const open = indexedDB.open('dts-sign', 1);
        open.onsuccess = () => {
          const keys = open.result.transaction('kv').objectStore('kv').getAllKeys();
          keys.onsuccess = () => resolve((keys.result as string[]).filter((k) => /^[sm]:/.test(k)));
        };
      }),
    );
    expect(stored).toEqual([]);
  });

  test('shows the race as place, time and name and names the download after it', async ({ page, context }) => {
    const links = await upload(page);
    const manage = await context.newPage();
    await manage.goto(local(links.manage));
    await expect(manage.getByRole('heading', { name: /^Deventer - Regio NoordOost 3 - \d\d\.\d\d uur - NO1$/ })).toBeVisible();
  });

  test('lets the admin close a race, after which the signer cannot change it', async ({ page, context }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').first().getByRole('button', { name: 'Details' }).click();
    const race = admin.locator('.race', { hasText: 'NO1' });
    await race.getByRole('button', { name: 'Inschrijving sluiten' }).click();
    await expect(race.getByRole('button', { name: 'Heropenen' })).toBeVisible();

    await page.bringToFront();
    await expect(page.getByText('gesloten door de beheerder')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Markeer als getekend' })).toHaveCount(0);

    await admin.bringToFront();
    await race.getByRole('button', { name: 'Heropenen' }).click();
    await expect(race.getByRole('button', { name: 'Inschrijving sluiten' })).toBeVisible();
  });

  test('offers to print the QR code right after creating a list', async ({ page }) => {
    await page.goto('/dts-admin/new');
    await page.setInputFiles('input[type=file]', { name: 'DTS_test.xml', mimeType: 'text/xml', buffer: Buffer.from(sampleXml()) });
    await expect(page.getByRole('heading', { name: /Klaar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print de QR-code' })).toBeVisible();
    await expect(page.locator('.qrraces')).toBeHidden();
  });

  test('shows the sign link and QR code of a list again on /dts', async ({ page }) => {
    const links = await upload(page);
    await page.goto('/dts-admin/');
    const row = page.locator('.sessions > li').first();
    await row.getByText('Link/QR voor jury-inschrijver(s)', { exact: true }).click();
    await expect(row.locator('.url')).toHaveText(links.sign);
    await expect(row.getByRole('img', { name: /QR-code/ })).toBeVisible();
    await expect(row.getByText('alleen met de inschrijvers')).toBeVisible();
    await expect(row.locator('.qrraces')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(row.locator('.qrraces li')).toHaveCount(2);
    await expect(row.locator('.qrraces')).toContainText(/NO1[\s\S]*NO2|NO2[\s\S]*NO1/);
  });

  test('lets the admin add and then change a competitor without any sign key', async ({ page, context }) => {
    await upload(page);
    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').first().getByRole('button', { name: 'Details' }).click();
    await admin.locator('.addnew a').first().click();
    await admin.getByLabel('Naam', { exact: true }).fill('Esselink, Eva');
    await admin.getByLabel('Beennummer', { exact: true }).fill('x5');
    await admin.getByLabel('Transponder 1').fill('aa-12345');
    await admin.getByRole('button', { name: 'Opslaan' }).click();
    await expect(admin).toHaveURL(/\/dts-admin\/list\?s=/);
    const added = admin.locator('.num').filter({ hasText: 'X5' });
    await expect(added).toBeVisible();

    const [details] = await Promise.all([admin.context().waitForEvent('page'), added.getByRole('link').click()]);
    await details.getByRole('link', { name: 'Gegevens aanpassen' }).click();
    await expect(details).toHaveURL(/\/dts-admin\/edit\?s=/);
    await details.getByLabel('Beennummer', { exact: true }).fill('x6');
    await details.getByRole('button', { name: 'Opslaan' }).click();
    await expect(details).toHaveURL(/\/dts-admin\/list\?s=/);
    await expect(details.locator('.num').filter({ hasText: 'X6' })).toBeVisible();
  });

  test('does not save a change to a competitor of a closed race and opens the edit form from a trailing slash', async ({ page, context }) => {
    await upload(page);
    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').first().getByRole('button', { name: 'Details' }).click();
    const race = admin.locator('.race', { hasText: 'NO1' });
    const href = await race.locator('a.numlink').first().getAttribute('href');
    await race.getByRole('button', { name: 'Inschrijving sluiten' }).click();
    await expect(race.getByRole('button', { name: 'Heropenen' })).toBeVisible();

    await admin.goto(`${href!.replace('/list', '/edit/')}`);
    await expect(admin.getByRole('heading', { name: 'Deelnemer aanpassen' })).toBeVisible();
    await expect(admin.getByRole('alert').filter({ hasText: 'gesloten' })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
  });

  test('lets the admin open the details of a list and download the signed file', async ({ page, context }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    await expect(page.getByText('In sync met server')).toBeVisible();

    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').filter({ hasText: 'NO1' }).first().getByRole('button', { name: 'Details' }).click();
    await expect(admin).toHaveURL(/\/dts-admin\/list\?s=[0-9a-f]{32}$/);
    const race = admin.locator('.race', { hasText: 'NO1' });
    await expect(race.locator('.count strong')).toHaveText(/^1 van /);
    const dts = admin.getByRole('button', { name: /^MDS-tekenlijst .*NO1$/ });
    const pdfButton = admin.getByRole('button', { name: /^PDF .*NO1$/ });
    // the downloads sit in the next steps, which appear when the race is closed
    await expect(dts).toHaveCount(0);
    await expect(pdfButton).toHaveCount(0);
    await race.getByRole('button', { name: 'Inschrijving sluiten' }).click();
    await expect(race.locator('.nextsteps').getByRole('button', { name: /^MDS-tekenlijst/ })).toBeVisible();
    await race.getByRole('button', { name: /^Uitklappen/ }).click();
    const [one] = await Promise.all([admin.waitForEvent('download'), dts.click()]);
    expect(await (await import('node:fs/promises')).readFile(await one.path(), 'utf8')).toContain('<Getekend>1</Getekend>');
    const [src] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Origineel DTS-bestand (zonder handtekeningen)' }).click()]);
    expect(src.suggestedFilename()).toBe('DTS_original.xml');
    expect(await (await import('node:fs/promises')).readFile(await src.path(), 'utf8')).not.toContain('<Getekend>1</Getekend>');
    // the PDF opens in a new tab for preview; a browser without a PDF viewer (headless) downloads it there
    // the listener sits on the tab from the moment it exists, so a download that starts at once is not missed
    const pdfDownload = new Promise<Download>((resolve) => admin.context().on('page', (tab) => tab.once('download', resolve)));
    await admin.getByRole('button', { name: /^PDF .*NO1$/ }).click();
    const pdf = await pdfDownload;
    const bytes = await (await import('node:fs/promises')).readFile(await pdf.path());
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(bytes.toString('latin1')).toContain('(Logboek)');

    const number = race.locator('.num').filter({ hasText: '11' });
    const tip = (await number.getAttribute('title')) ?? '';
    expect(tip.split('\n')).toHaveLength(5);
    expect(tip.split('\n')[0]).toMatch(/^Getekend ✓/);
    expect(tip).toContain('Aardappel');
    const [details] = await Promise.all([admin.context().waitForEvent('page'), number.getByRole('link').click()]);
    await details.waitForLoadState();
    await expect(details).toHaveURL(/&c=/);
    const opened = admin.context().pages().length;
    await details.waitForTimeout(300);
    expect(details.context().pages()).toHaveLength(opened);
    await expect(details.getByRole('heading', { name: /Aardappel/ })).toBeVisible();
    await expect(details.locator('.badges')).toContainText('Transponder 1');
    await expect(details.getByRole('link', { name: 'Gegevens aanpassen' })).toHaveAttribute('href', /^\/dts-admin\/edit\?s=[0-9a-f]{32}&c=/);
    await details.getByRole('link', { name: /Terug naar DTS Tekenlijst Overzicht/ }).click();
    await expect(details.locator('.race', { hasText: 'NO1' })).toBeVisible();
    await details.getByRole('button', { name: /Terug naar beheer/ }).click();
    await expect(details.getByRole('heading', { name: 'Tekenlijsten beheren' })).toBeVisible();
  });

  test('returns the admin from the add screen to the list it came from', async ({ page, context }) => {
    await upload(page);
    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').filter({ hasText: 'NO1' }).first().getByRole('button', { name: 'Details' }).click();
    const list = admin.url();
    await admin.locator('.race', { hasText: 'NO1' }).getByRole('link', { name: /Nieuwe deelnemer/ }).click();
    await expect(admin.getByRole('heading', { name: 'Nieuwe deelnemer' })).toBeVisible();
    await admin.getByRole('link', { name: /Terug/ }).click();
    await expect(admin).toHaveURL(list);
    await expect(admin.getByRole('heading', { name: 'Tekenlijsten beheren' }).or(admin.locator('.race', { hasText: 'NO1' }))).toBeVisible();
  });

  test('shows when a signing device was seen as relative time and lets the admin remove it', async ({ page, context }) => {
    await upload(page);
    await open(page, '11', /11\s+Aardappel/);
    await page.getByRole('button', { name: 'Markeer als getekend' }).click();
    const admin = await context.newPage();
    await admin.goto('/dts-admin/');
    await admin.locator('.sessions > li').first().getByRole('button', { name: 'Details' }).click();
    const device = admin.locator('.panels li').filter({ hasText: /gezien (zojuist|\d+ min geleden)/ });
    await expect(device).toBeVisible({ timeout: 20000 });
    await expect(device).toContainText('1 getekend, 0 wijzigingen');
    await expect(admin.locator('.log a').first()).toHaveAttribute('href', /&c=/);
    await expect(admin.locator('.log a').first()).toHaveText(/^11 \S/);
    await expect(admin.locator('.log a').first()).not.toContainText('NO1');
    admin.once('dialog', (d) => d.accept());
    await device.getByRole('button', { name: 'Verwijderen' }).click();
    await expect(device).toHaveCount(0);
  });

  test('keeps a session when the delete is cancelled', async ({ page }) => {
    await upload(page);
    await page.goto('/dts-admin/');
    const rows = page.locator('.sessions > li');
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    page.once('dialog', (d) => d.dismiss());
    await rows.first().getByRole('button', { name: 'Verwijderen' }).click();
    await expect(rows).toHaveCount(before);
  });

  test('still fits a narrow window without horizontal scroll', async ({ page, context }) => {
    const links = await upload(page);
    const manage = await context.newPage();
    await manage.setViewportSize({ width: 600, height: 800 });
    await manage.goto(local(links.manage));
    await expect(manage.locator('.race').first()).toBeVisible();
    expect(await manage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
