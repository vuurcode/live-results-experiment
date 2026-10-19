import { expect, test } from '@playwright/test';
import { MOCK_URL } from './env';
import { slider } from './slider';

const LOGS = '/logs?competitionId=e2e-pairs';

test.describe('logs page', () => {
  test('lists the events after the initial load latest first, each with its heat and what changed', async ({ page, request }) => {
    await page.goto(LOGS);
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    const items = page.locator('.logs-item');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    await expect(items.first().locator('.logs-heat')).toContainText(/Heat \d/);
    await expect(items.first().locator('.logs-changes li').first()).toBeVisible();
    // a lap time shows as a change of its lap
    await expect(page.locator('.logs-field', { hasText: /^Lap \d$/ }).first()).toBeVisible({ timeout: 15_000 });
    // latest first
    const times = await page.locator('.logs-time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime') ?? ''));
    expect(times.length).toBeGreaterThan(1);
    expect(times).toEqual([...times].sort().reverse());
  });

  test('a remark change is the badge of the cards, in the same colour', async ({ page, request }) => {
    await page.goto(LOGS);
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    const pb = page.locator('.logs-changes c-badge.individual-badge-purple', { hasText: 'PB' }).first();
    await expect(pb).toBeVisible({ timeout: 20_000 });
    await expect(pb).toHaveCSS('background-color', 'rgb(111, 66, 193)');
    await expect(page.locator('.logs-changes c-badge.individual-badge-orange', { hasText: 'DNF' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a skater is named in the colour of their lane, as on the cards', async ({ page, request }) => {
    await page.goto(LOGS);
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    const name = page.locator('.logs-name[data-lane]', { hasText: /^Competitor [A-C]$/ }).first();
    await expect(name).toBeVisible({ timeout: 20_000 });
    const [text, lane, background] = await name.evaluate((el) => [el.textContent ?? '', el.getAttribute('data-lane') ?? '', getComputedStyle(el).backgroundColor]);
    await page.goto('/?competitionId=e2e-pairs');
    const card = page.locator('.individual-comp-name-text', { hasText: text }).first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-lane', lane);
    await expect(card).toHaveCSS('background-color', background);
  });

  test('the heat of an event links to that heat on the dashboard', async ({ page, request }) => {
    await page.goto(LOGS);
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    const link = page.locator('a.logs-heat').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const label = ((await link.innerText()).match(/Heat \d+/) ?? [''])[0];
    await link.click();
    await expect(page).toHaveURL(/^[^?]*\/?\?.*competitionId=e2e-pairs/);
    await expect(slider(page)).toHaveAttribute('aria-valuetext', new RegExp(`${label}$`));
  });

  test('the results that were there when the page opened are no events', async ({ page, request }) => {
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    // the replay has played out by the time the page is opened
    await page.waitForTimeout(9_000);
    await page.goto(LOGS);
    await expect(page.locator('.logs-none')).toBeVisible();
    await expect(page.locator('.logs-item')).toHaveCount(0);
  });

  test('the log is kept in the browser: a reload still shows what came in before, and yesterday is dropped', async ({ page, request }) => {
    await page.goto(LOGS);
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    await expect(page.locator('.logs-item').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(9_000); // the replay ends and the log is written
    const before = await page.locator('.logs-item').count();
    await page.reload();
    await expect(page.locator('.logs-item')).toHaveCount(before);
    // an entry from an earlier day is gone on the next load
    await page.evaluate(() => {
      const key = 'eventLog:e2e-pairs';
      const entries = JSON.parse(localStorage.getItem(key) ?? '[]');
      entries[0].at -= 36 * 3600_000;
      localStorage.setItem(key, JSON.stringify(entries));
    });
    await page.reload();
    await expect(page.locator('.logs-item')).toHaveCount(before - 1);
  });

  test('updates are logged while another page is open', async ({ page, request }) => {
    await page.goto('/?competitionId=e2e-pairs');
    await expect(page.locator('.individual-competitor-card').first()).toBeVisible();
    await page.waitForTimeout(2_500); // past the initial load
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    await page.waitForTimeout(9_000); // the replay plays while the dashboard is on screen
    await page.goto(LOGS);
    await expect(page.locator('.logs-item').first()).toBeVisible();
  });

  test('an update to a heat before one with results is marked, and the others are not', async ({ page }) => {
    // a stored log: a correction to Heat 1 after Heat 2 had results, and a plain update of Heat 2
    await page.addInitScript(() => {
      const at = Date.now() - 60_000;
      const entry = (id: number, heat: number, past: boolean) => ({
        id, batch: id, at: at + id * 1000, distanceId: 'dist-500', distanceName: '500 meter', raceId: `r${id}`, heat, name: `Skater ${id}`, lane: 'red', past, isNew: false,
        changes: [{ field: 'lap', n: 1, from: '10.100', to: '10.102' }],
      });
      if (!localStorage.getItem('eventLog:e2e-pairs')) localStorage.setItem('eventLog:e2e-pairs', JSON.stringify([entry(2, 1, true), entry(1, 2, false)]));
    });
    await page.goto(LOGS);
    const past = page.locator('.logs-item', { hasText: 'Skater 2' });
    await expect(past).toHaveClass(/past/);
    await expect(past).toHaveCSS('background-color', /color\(srgb 1 0\.7\d* 0\.0\d* \/ 0\.16\)/);
    await expect(past.locator('.visually-hidden')).toHaveText(/Earlier heat/);
    await expect(page.locator('.logs-item', { hasText: 'Skater 1' })).not.toHaveClass(/past/);
  });

});
