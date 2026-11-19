import { expect, type Page } from '@playwright/test';
import { sampleXml } from './dts-sample';

/** Uploads a generated race-day file on the sign page and returns the two links of the created screen. */
export async function upload(page: Page, xml = sampleXml()) {
  await page.goto('/dts/sign?new=1');
  await page.setInputFiles('input[type=file]', { name: 'DTS_test.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.getByRole('heading', { name: /Klaar/ })).toBeVisible();
  const links = await page.locator('.url').allTextContents();
  const sign = links[0].trim();
  await page.getByRole('button', { name: 'Verder' }).click();
  await page.waitForURL(/\/dts\/manage#/);
  const manage = page.url();
  await page.goto(`/dts/sign?s=${local(sign).split('#')[1].split('.')[0]}`);
  await expect(page.getByLabel('Beennummer of naam')).toBeVisible();
  return { sign, manage };
}

/** Finds a racer on the sign page home screen by leg number and opens the racer. */
export async function open(page: Page, cap: string, name: string | RegExp) {
  await page.getByLabel('Beennummer of naam').fill(cap);
  await page.getByRole('button', { name }).click();
}

/** The path and fragment of a full link, so it opens on the test server whatever host the page printed. */
export const local = (link: string): string => link.replace(/^https?:\/\/[^/]+/, '');
