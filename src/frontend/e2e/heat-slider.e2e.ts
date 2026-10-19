import { expect, test } from '@playwright/test';
import { MOCK_URL } from './env';
import { heatUrl, slider } from './slider';

test.describe('heat slider', () => {
  test('Home and End move to the first and last heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 2));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 2$/, { timeout: 15_000 });
    await slider(page).focus();
    await page.keyboard.press('Home');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 1$/);
    await page.keyboard.press('End');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/);
  });

  test('the live pill brings a pinned view back to the live heat', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    const pill = page.locator('.live-pill');
    await expect(pill).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
  });

  test('the live pill stays inside the bar and the live line touches it, at the start, the middle and the end', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 1));
    const pill = page.locator('.live-pill');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    for (const at of [0, 0.5, 1]) {
      const box = await page.evaluate((fraction) => {
        const pillEl = document.querySelector<HTMLElement>('.live-pill')!;
        const line = document.querySelector<HTMLElement>('.mark-live')!;
        const bar = document.querySelector<HTMLElement>('.heat-slider')!;
        pillEl.style.transition = 'none';
        line.style.transition = 'none';
        pillEl.style.setProperty('--at', String(fraction));
        line.style.setProperty('--at', String(fraction));
        const p = pillEl.getBoundingClientRect();
        const l = line.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        return { pillLeft: p.left, pillRight: p.right, line: l.left + l.width / 2, barLeft: b.left, barRight: b.right, height: p.height };
      }, at);
      expect(box.pillLeft, `at ${at}`).toBeGreaterThanOrEqual(box.barLeft - 1);
      expect(box.pillRight, `at ${at}`).toBeLessThanOrEqual(box.barRight + 1);
      expect(box.line, `at ${at}`).toBeGreaterThanOrEqual(box.pillLeft + 8);
      expect(box.line, `at ${at}`).toBeLessThanOrEqual(box.pillRight - 8);
      expect(box.height, `at ${at}: one line`).toBeLessThan(40);
    }
  });

  test('the position is announced as the heat label of the step', async ({ page }) => {
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 3));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/, { timeout: 15_000 });
  });

  test('a short event keeps its heat ticks on a narrow screen, since it needs no zoom', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/?competitionId=e2e-pairs');
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.mark-tick').count()).toBeGreaterThan(0);
  });

  test('a narrow screen hints once that the bar can be slid, until it is used', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/?competitionId=e2e-pairs');
    const hint = page.locator('.slide-hint');
    await expect(hint).toContainText('Swipe left or right to change heat', { timeout: 15_000 });
    await expect(hint).toBeVisible();
    // the heat swings to and fro while the hint is up
    await expect(page.locator('.step-view.swipe-hint .individual-competitor-card').first()).toHaveCSS('animation-name', /swipeHint$/);
    await slider(page).focus();
    await page.keyboard.press('Home');
    await expect(hint).toHaveCount(0);
    await expect(page.locator('.step-view.swipe-hint')).toHaveCount(0);
    await page.reload();
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await expect(hint).toHaveCount(0);
  });

  test('a wide screen shows no slide hint', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?competitionId=e2e-pairs');
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.slide-hint')).toHaveCount(0);
  });

  test('the slider fits the screen without horizontal scroll', async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?competitionId=e2e-pairs');
      await expect(slider(page)).toBeVisible({ timeout: 15_000 });
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw).toBeLessThanOrEqual(cw);
    }
  });
});

test.describe('heats to come', () => {
  test('a card of a heat that has not started shows an empty grey badge for every lap, with its distance', async ({ page, request }) => {
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 3));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/, { timeout: 15_000 });
    const card = page.locator('.individual-competitor-card:not(.individual-lane-placeholder)').first();
    // the heat is skated while the test runs, so the laps still to come are read in one go: each has a distance above its badge
    await expect(async () => {
      const badges = await card.locator('.individual-ghost-badge').count();
      expect(badges).toBeGreaterThan(0);
      const distances = await card.locator('.individual-compact-lap[aria-hidden] .compact-dist').allInnerTexts();
      expect(distances).toHaveLength(badges);
      for (const text of distances) expect(text).toMatch(/^\d+m$/);
    }).toPass({ timeout: 10_000 });
    await expect(card.locator('.individual-ghost-badge').first()).toBeVisible();
    await expect(card.locator('.individual-ghost-hidden')).toHaveCount(0);
  });

  test('a ghost lap badge is empty and hidden from assistive technology, and its place is taken by the real time in the same spot', async ({ page, request }) => {
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
    await page.goto(heatUrl('e2e-pairs', 'dist-500', 3));
    await expect(slider(page)).toHaveAttribute('aria-valuetext', /Heat 3$/, { timeout: 15_000 });
    const card = page.locator('.individual-competitor-card:not(.individual-lane-placeholder)').first();
    const laps = card.locator('.individual-comp-body .individual-compact-lap');
    let schedule: string[] | null = null;
    let sawReal = false;
    await expect(async () => {
      // every lap of the distance is on the card, as a time or as a ghost, in the same order, whatever the moment
      const snapshot = await laps.evaluateAll((els) =>
        els.map((el) => ({ distance: el.querySelector('.compact-dist')?.textContent?.trim() ?? '', ghost: el.hasAttribute('aria-hidden'), badge: el.querySelector('c-badge')?.textContent?.replace(/\u00a0/g, '').trim() ?? '' })),
      );
      expect(snapshot.length).toBeGreaterThan(0);
      const distances = snapshot.map((l) => l.distance);
      schedule ??= distances;
      expect(distances).toEqual(schedule);
      for (const lap of snapshot) if (lap.ghost) expect(lap.badge).toBe(''); // a ghost has no text
      // the times come first and the ghosts after them: a ghost never sits before a time
      const firstGhost = snapshot.findIndex((l) => l.ghost);
      if (firstGhost !== -1) expect(snapshot.slice(firstGhost).every((l) => l.ghost)).toBe(true);
      sawReal ||= snapshot.some((l) => !l.ghost);
      expect(sawReal).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});
