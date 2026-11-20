import { expect, type Page } from '@playwright/test';
import { sampleXml } from './dts-sample';

/** Uploads a generated race-day file on the management page, then opens the sign link on this page. Returns the sign link and the management list link. */
export async function upload(page: Page, xml = sampleXml()) {
  await page.goto('/dts-admin/new');
  await page.setInputFiles('input[type=file]', { name: 'DTS_test.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.getByRole('heading', { name: /Klaar/ })).toBeVisible();
  const sign = (await page.locator('.url').first().textContent())!.trim();
  await page.getByRole('link', { name: 'Verder' }).click();
  await page.waitForURL(/\/dts-admin\/list\?s=/);
  const manage = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.goto(local(sign));
  await nameDevice(page);
  await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
  return { sign, manage };
}

/** Answers the "who are you" screen a device shows on its first visit to a list. */
export async function nameDevice(page: Page, name = 'Balie 1') {
  await page.getByLabel('Je naam').fill(name);
  await page.getByRole('button', { name: 'Verder' }).click();
}

/** Finds a racer on the sign page home screen by leg number and opens the racer. */
export async function open(page: Page, cap: string, name: string | RegExp) {
  await page.getByLabel('Beennummer of naam').fill(cap);
  await page.getByRole('button', { name }).click();
}

/** The path and fragment of a full link, so it opens on the test server whatever host the page printed. */
export const local = (link: string): string => link.replace(/^https?:\/\/[^/]+/, '');
