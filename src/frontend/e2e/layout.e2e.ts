import { expect, test } from '@playwright/test';
import { MOCK_URL } from './env';
import { heatUrl, openMenu, settingsUrl } from './slider';

test.describe('large screens', () => {
  for (const [width, font] of [
    [1280, 16],
    [1920, 16],
    [2560, 21.33],
    [3840, 32],
  ] as const) {
    test(`${width}px wide: root font size scales to ${font}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto('/?competitionId=e2e-individual');
      const px = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      expect(px).toBeCloseTo(font, 1);
    });
  }

  test('4K: card names and the watermark stay inside their card', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    await expect(page.locator('.individual-watermark').first()).toBeVisible({ timeout: 15_000 });
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('.individual-competitor-card')].filter((card) => {
        const c = card.getBoundingClientRect();
        return [...card.querySelectorAll('.individual-watermark, .individual-card-name, .fw-semibold')].some((el) => {
          const r = el.getBoundingClientRect();
          return r.left < c.left - 1 || r.right > c.right + 1;
        });
      }).length,
    );
    expect(overflowing).toBe(0);
  });
});

test.describe('pinned titles', () => {
  test('the groups overview of a mass start stays pinned below the title', async ({ page, request }) => {
    // start the replay over so the groups exist and the page is tall enough to scroll
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-mass' } });
    await page.waitForTimeout(800);
    await page.setViewportSize({ width: 1280, height: 330 });
    await page.goto('/?competitionId=e2e-mass');
    const strip = page.locator('.groups-strip').first();
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500); // the badges settle on their lines
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.waitForTimeout(300);
    const box = (await strip.boundingBox())!;
    const barBottom = await page.evaluate(() => document.querySelector('.topbar')!.getBoundingClientRect().bottom);
    expect(box.y).toBeGreaterThanOrEqual(barBottom - 1);
    expect(box.y).toBeLessThan(150);
  });
});

test.describe('mass start timeline', () => {
  for (const width of [390, 1280, 3840]) {
    test(`${width}px: the racers sit on one axis, leader at the right, never overlapping or cut off`, async ({ page, request }) => {
      await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-mass' } });
      await page.waitForTimeout(800);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?competitionId=e2e-mass');
      await expect(page.locator('.mass-timeline .timeline-leader')).toBeVisible({ timeout: 15_000 }); // the racers are placed from the first update on
      await page.waitForTimeout(600); // the badges slide into place
      const { boxes, lane } = await page.evaluate(() => {
        const l = document.querySelector('.mass-timeline .timeline-lane')!.getBoundingClientRect();
        const bs = [...document.querySelectorAll('.mass-timeline .timeline-racer')].map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        return { boxes: bs, lane: { x: l.x, right: l.right, bottom: l.bottom } };
      });
      expect(boxes.length).toBeGreaterThan(1);
      expect(Math.abs(boxes[0].x + boxes[0].w - lane.right)).toBeLessThanOrEqual(1); // the leader is at the right edge
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(lane.x - 1);
        expect(b.y + b.h).toBeLessThanOrEqual(lane.bottom + 1);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
          expect(overlap, `racers ${i} and ${j} overlap: ${JSON.stringify(boxes)}`).toBe(false);
        }
      }
    });
  }
});

test('racing competitor card titles have the same height with or without badges', async ({ page, request }) => {
  await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-pairs' } });
  await page.goto('/?competitionId=e2e-pairs');
  await expect(page.locator('.individual-comp-header').first()).toBeVisible();
  await expect(page.locator('.individual-comp-header .individual-split-badge').first()).toBeVisible(); // some titles carry a badge
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.individual-comp-header')].map((h) => Math.round(h.getBoundingClientRect().height * 10) / 10),
  );
  expect(heights.length).toBeGreaterThan(1);
  expect([...new Set(heights)], String(heights)).toHaveLength(1);
});

test.describe('menu and tooltips', () => {
  test('the help text is always shown under its setting and fits inside the settings page', async ({ page }) => {
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(settingsUrl('e2e-individual'));
      const bodies = page.locator('.settings-page .setting-popover-body:visible');
      await expect(bodies.first()).toBeVisible(); // without hovering anything
      const panel = (await page.locator('.settings-page').boundingBox())!;
      for (const body of await bodies.all()) {
        const box = (await body.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
      }
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw).toBeLessThanOrEqual(cw);
    }
  });

  test('a lap badge has a tooltip with distance, lap time and total time on three rows', async ({ page, request }) => {
    await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: 'e2e-individual' } });
    await page.goto('/?competitionId=e2e-individual');
    const badge = page.locator('.individual-compact-badge').first();
    await expect(badge).toBeVisible({ timeout: 30000 });
    const title = await badge.getAttribute('title');
    expect(title!.split('\n')).toHaveLength(3);
    expect(title).toMatch(/^Distance: \d+m\nLap time: [\d:.]+\nTotal time: [\d:.]+$/);
    expect(await badge.evaluate((e) => getComputedStyle(e).cursor)).toBe('help');
  });
});

test.describe('a heat of two skaters', () => {
  // heat 1 has only white/red, heat 2 has all four lanes
  for (const width of [1280, 700]) {
    test(`${width}px: is a row of its own with two cards, while the full heat keeps its four lanes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?competitionId=e2e-lanes');
      await expect(page.locator('.individual-heat-row').first().locator('.individual-lane-col')).toHaveCount(2);
      await expect(page.locator('.individual-heat-row').nth(1).locator('.individual-lane-col')).toHaveCount(4);
    });
  }
});

test.describe('card side padding', () => {
  for (const width of [1280, 900, 600, 390]) {
    test(`${width}px: the name and the total time keep the same distance from the card's sides`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
      await expect(page.locator('.individual-compact-final').first()).toBeVisible({ timeout: 30000 });
      const edges = await page.evaluate(() =>
        [...document.querySelectorAll('.individual-competitor-card:not(.individual-lane-placeholder)')].map((card) => {
          const c = card.getBoundingClientRect();
          const left = (sel: string) => { const e = card.querySelector(sel); return e ? e.getBoundingClientRect().left - c.left : null; };
          const right = (sel: string) => { const e = card.querySelector(sel); return e ? c.right - e.getBoundingClientRect().right : null; };
          return { name: left('.individual-comp-name'), total: right('.individual-compact-final') };
        }),
      );
      for (const e of edges) {
        if (e.total !== null && e.name !== null) expect(Math.abs(e.total - e.name), `total right vs name left: ${JSON.stringify(e)}`).toBeLessThanOrEqual(2);
      }
    });
  }
});

test('on a short screen the open menu stays inside the viewport and scrolls to its last link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 260 });
  await page.goto('/?competitionId=e2e-individual');
  await openMenu(page);
  const panel = page.locator('#mainMenu');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(260 + 1);
  await page.locator('#mainMenu .menu-panel').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = (await panel.locator('.menu-link').last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(260 + 1);
});
