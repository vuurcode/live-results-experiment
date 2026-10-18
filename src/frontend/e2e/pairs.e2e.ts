import { expect, test, type APIRequestContext } from '@playwright/test';
import { MOCK_URL } from './env';
import { heatUrl, settingsUrl, slider } from './slider';

// A two-lane (pairs) competition: a DNF and a personal best in one pair, a skater without an opponent, a normal pair.
const COMPETITION = 'e2e-pairs';

async function restartReplay(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: COMPETITION } });
  expect(res.ok()).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 800));
}

test.describe('two-lane competition', () => {
  test('shows pairs, a lone skater, a DNF and a personal best', async ({ page, request }) => {
    await restartReplay(request);
    // one heat per slider step, with at most the two lanes
    const cards = page.locator('.individual-competitor-card:not(.individual-lane-placeholder)');
    for (const [heat, count] of [[1, 2], [2, 1], [3, 2]] as const) {
      await page.goto(heatUrl(COMPETITION, 'dist-500', heat));
      await expect(slider(page)).toHaveAttribute('aria-valuetext', new RegExp(`Heat ${heat}$`));
      await expect(page.locator('.individual-heat-row')).toHaveCount(1);
      await expect(cards).toHaveCount(count);
      // the lone skater's heat keeps an empty slot for the missing lane
      await expect(page.locator('.individual-lane-placeholder')).toHaveCount(count === 1 ? 1 : 0);
    }
    await page.goto(heatUrl(COMPETITION, 'dist-500', 1));

    // once the replay has finished: A set a personal best, B did not finish
    const cardA = page.locator('.individual-competitor-card', { hasText: 'Competitor A' });
    const cardB = page.locator('.individual-competitor-card', { hasText: 'Competitor B' });
    await expect(cardB.getByText('DNF', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(cardA.locator('.individual-compact-badge')).toHaveCount(2);
    await expect(cardA.getByText('PB', { exact: true })).toBeVisible();
    // times are in hundredths by default, thousandths on request
    await expect(cardA.locator('.individual-compact-final .race-time')).toHaveText(/^\d+:?\d*\.\d{2}$/);
    await page.goto(settingsUrl(COMPETITION));
    await page.locator('#thousandthsInput').check();
    await page.goto(heatUrl(COMPETITION, 'dist-500', 1));
    await expect(cardA.locator('.individual-compact-final .race-time')).toHaveText(/\.\d{3}$/);
    // the old personal best on the card title is struck through (a line drawn across it) once it has been beaten
    await expect(cardA.locator('.individual-pb-beaten')).toBeVisible();
    await expect
      .poll(() => cardA.locator('.individual-pb-beaten').evaluate((el) => getComputedStyle(el, '::after').height))
      .toBe('1px');
    // ... and stays plain for a skater who did not improve it (Competitor C, in the next heat, finished slower than 43.0)
    await page.goto(heatUrl(COMPETITION, 'dist-500', 2));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 2$/);
    await expect(page.locator('.individual-competitor-card', { hasText: 'Competitor C' }).locator('.individual-pb-beaten')).toHaveCount(0);
    // a time slower than the personal best shows the difference as an orange watermark, not as a badge
    const slower = page.locator('.individual-competitor-card', { hasText: 'Competitor C' }).locator('.individual-watermark-slower');
    await expect(slower).toHaveText(/^\+ \d/);
    await expect(slower).toHaveCSS('color', /rgba?\(154, 74, 0/);
  });
});

test.describe('personal best wording follows the browser language', () => {
  for (const [locale, term, other] of [
    ['en-US', 'PB', 'PR'],
    ['nl-NL', 'PR', 'PB'],
  ] as const) {
    test.describe(locale, () => {
      test.use({ locale });
      test(`uses ${term}, never ${other}`, async ({ page, request }) => {
        await restartReplay(request);
        await page.goto(heatUrl(COMPETITION, 'dist-500', 1));
        await expect(page.locator('html')).toHaveAttribute('lang', locale.slice(0, 2));
        const cardA = page.locator('.individual-competitor-card', { hasText: 'Competitor A' });
        await expect(cardA.getByText(term, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.individual-competitor-card').getByText(other, { exact: true })).toHaveCount(0);
        await expect(cardA.getByText(term === 'PB' ? 'Previous PB' : 'Vorig PR')).toBeVisible();
      });
    });
  }
});

test.describe('long names', () => {
  for (const width of [320, 1280]) {
    test(`${width}px: long and unbreakable names stay inside their cards`, async ({ page, request }) => {
      await restartReplay(request);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?competitionId=${COMPETITION}`); // following the replay ends on the heat with the long names
      await expect(page.locator('.individual-competitor-card', { hasText: 'Magnificent Maximiliaan' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.individual-competitor-card', { hasText: 'Supercalifragilistic' })).toBeVisible();
      await expect(page.locator('.individual-compact-badge').first()).toBeVisible({ timeout: 15_000 });

      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const card of document.querySelectorAll('.individual-competitor-card')) {
          const c = card.getBoundingClientRect();
          for (const el of card.querySelectorAll('.individual-comp-name, .individual-watermark, .individual-badge-orange, .individual-split-badge')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.left < c.left - 1 || r.right > c.right + 1)) {
              out.push(`${el.className} sticks out of "${card.querySelector('.individual-comp-name')?.textContent?.slice(0, 20)}"`);
            }
          }
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('page scrolls horizontally');
        return out;
      });
      expect(problems).toEqual([]);
    });
  }
});
