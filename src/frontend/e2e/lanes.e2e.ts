import { expect, test } from '@playwright/test';
import { heatUrl } from './slider';

// The dashboard shows one heat; e2e-lanes is a fixed snapshot: heat 1 has a PB and a DNF, heat 2 a full set of four lanes.
const FOUR_LANES_MIN = 1280;
const READABLE_CARD_WIDTH = 300;

test.describe('lanes of one heat', () => {
  for (const width of [320, 768, FOUR_LANES_MIN, 2560]) {
    test(`${width}px: a full heat shows its four cards one below the other, each readable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(heatUrl('e2e-lanes', 'dist-500', 2));
      const cards = page.locator('.individual-heat-row').nth(1).locator('.individual-competitor-card:not(.individual-lane-placeholder)');
      await expect(cards).toHaveCount(4);
      const boxes = await cards.evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), width: r.width };
      }));
      expect(new Set(boxes.map((b) => b.top)).size).toBe(4);
      for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(Math.min(READABLE_CARD_WIDTH, width - 40));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('card watermark placement', () => {
  // The diff to the personal best is dead centre in the title from 768px and hangs at its bottom right below that.
  // A remark note sits in the top right of the title; with four lanes in a row a card without a time (here a DNF) has it dead centre in the whole card.
  // the note stamps in (grows to its place) once the final lap has settled: measure it when that has finished
  async function stamped(card: import('@playwright/test').Locator) {
    await expect.poll(() => card.evaluate((c) => getComputedStyle(c.querySelector('.individual-watermark')!).scale), { timeout: 15_000 }).toBe('none');
  }

  interface Placement { dx: number; dy: number; rightGap: number; topGap: number; bottomGap: number }

  async function pbPlacement(page: import('@playwright/test').Page, width: number): Promise<Placement> {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    const card = page.locator('.individual-competitor-card', { hasText: 'Competitor A' });
    // measured in the same step that sees the watermark settled: the replay moves on every few seconds and the watermark
    // can be gone by the time a separate step looks for it
    let placement: Placement | null = null;
    await expect.poll(async () => {
      placement = await card.evaluate((c): Placement | null => {
        const title = c.querySelector('.individual-comp-title');
        const mark = c.querySelector('.individual-watermark');
        if (!title || !mark || getComputedStyle(mark).scale !== 'none') return null;
        const t = title.getBoundingClientRect();
        const w = mark.getBoundingClientRect();
        return { dx: (w.left + w.width / 2 - (t.left + t.width / 2)) / t.width, dy: w.top + w.height / 2 - (t.top + t.height / 2), rightGap: t.right - w.right, topGap: w.top - t.top, bottomGap: t.bottom - (w.top + w.height / 2) };
      }).catch(() => null);
      return placement !== null;
    }, { timeout: 15_000 }).toBe(true);
    return placement!;
  }

  // the label of a card without a time is placed against the card: its computed position is relative to what it is placed against
  async function noTimePlacement(page: import('@playwright/test').Page, width: number) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    const card = page.locator('.individual-competitor-card.individual-card-no-time', { hasText: 'Competitor B' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await stamped(card);
    return card.evaluate((c) => {
      const cs = getComputedStyle(c.querySelector('.individual-watermark-code')!);
      const r = c.getBoundingClientRect();
      return { left: cs.left, right: cs.right, top: cs.top, cardWidth: r.width, cardHeight: r.height };
    });
  }

  test('320px: a PB watermark sits at the right, in the bottom part of the card', async ({ page }) => {
    const o = await pbPlacement(page, 320);
    expect(o.rightGap).toBeLessThan(40);
    // the note sits in the bottom part of the card, below the title
    expect(o.bottomGap).toBeLessThan(0);
  });

  for (const width of [768, FOUR_LANES_MIN - 1, FOUR_LANES_MIN, 2560]) {
    test(`${width}px: a PB watermark is dead centre in the title`, async ({ page }) => {
      const o = await pbPlacement(page, width);
      expect(Math.abs(o.dx)).toBeLessThan(0.02);
      expect(Math.abs(o.dy)).toBeLessThan(4);
    });
  }

  test('a tap on a watermark clears it for five seconds', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    const card = page.locator('.individual-competitor-card.individual-card-no-time', { hasText: 'Competitor B' });
    await stamped(card);
    const mark = card.locator('.individual-watermark');
    await mark.click({ force: true });
    await expect(mark).toHaveCSS('opacity', '0');
    await expect(mark).toHaveCSS('opacity', '1', { timeout: 7000 });
  });

  test(`${FOUR_LANES_MIN - 1}px: the watermark of a card without a time sits in the top right of the title`, async ({ page }) => {
    const o = await noTimePlacement(page, FOUR_LANES_MIN - 1);
    expect(parseFloat(o.left)).toBeGreaterThan(o.cardWidth * 0.5); // right of the middle, next to the right edge
    expect(parseFloat(o.right)).toBeLessThan(40);
  });

  for (const width of [FOUR_LANES_MIN, 2560]) {
    test(`${width}px: the watermark of a card without a time is dead centre in the whole card`, async ({ page }) => {
      const o = await noTimePlacement(page, width);
      expect(Math.abs(parseFloat(o.left) - o.cardWidth / 2)).toBeLessThan(o.cardWidth * 0.02);
      expect(Math.abs(parseFloat(o.top) - o.cardHeight / 2)).toBeLessThan(o.cardHeight * 0.02);
    });
  }
});

test.describe('top bar icon', () => {
  for (const [width, shown] of [[FOUR_LANES_MIN - 1, false], [FOUR_LANES_MIN, true]] as const) {
    test(`${width}px: the app icon is ${shown ? 'shown' : 'hidden'}, named after the application on hover`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?competitionId=e2e-pairs');
      const icon = page.locator('.topbar-logo');
      await expect(page.locator('.topbar-logo-link')).toHaveAttribute('title', 'Live Results Experiment - Proof of Concept');
      await (shown ? expect(icon).toBeVisible() : expect(icon).toBeHidden());
    });
  }
});

test.describe('card content', () => {
  test('the category is named in full, with the club code in brackets behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    await expect(page.locator('.individual-competitor-card', { hasText: 'Competitor A' }).locator('.individual-comp-meta')).toHaveText('Women Juniors A1 (IFX)');
  });
});

test.describe('record cards', () => {
  test('WR, NR, TR and TRC show their own watermark and a purple total time badge', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/?competitionId=e2e-lanes');
    const expected: [string, string][] = [
      ['Competitor C', 'World Record'],
      ['Competitor D', 'National Record'],
      ['Competitor E', 'Track Record'],
      ['Competitor F', 'Track Record\n(Women Juniors A1)'],
    ];
    for (const [name, watermark] of expected) {
      const card = page.locator('.individual-competitor-card', { hasText: name });
      await expect(card.locator('.individual-comp-title')).toHaveAttribute('data-watermark', watermark, { timeout: 15_000 });
      await expect(card.locator('.individual-compact-final .individual-lap-time').first()).toHaveCSS('background-color', 'rgb(111, 66, 193)');
    }
  });
});

test.describe('cards on one row', () => {
  for (const width of [800, 1280]) {
    test(`${width}px: the cards of a row, and their titles, are as tall as the tallest`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(heatUrl('e2e-lanes', 'dist-500', 2));
      const cards = page.locator('.individual-heat-row').nth(1).locator('.individual-competitor-card:not(.individual-lane-placeholder)');
      await expect(cards).toHaveCount(4);
      const boxes = await cards.evaluateAll((els) => els.map((e) => ({
        top: Math.round(e.getBoundingClientRect().top),
        card: Math.round(e.getBoundingClientRect().height),
        title: Math.round(e.querySelector('.individual-comp-title')!.getBoundingClientRect().height),
        header: Math.round(e.querySelector('.individual-comp-header')!.getBoundingClientRect().height),
      })));
      for (const top of new Set(boxes.map((b) => b.top))) {
        const row = boxes.filter((b) => b.top === top);
        expect(new Set(row.map((b) => b.card)).size, `card heights ${JSON.stringify(row)}`).toBe(1);
        expect(new Set(row.map((b) => b.title)).size, `title heights ${JSON.stringify(row)}`).toBe(1);
        expect(new Set(row.map((b) => b.header)).size, `header heights ${JSON.stringify(row)}`).toBe(1);
      }
    });
  }
});

test.describe('card content is never clipped', () => {
  for (const width of [320, 800, 1400]) {
    test(`${width}px: a card is tall enough for its title and its body, also with the total next to the lap badges`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(heatUrl('e2e-lanes', 'dist-500', 2));
      const cards = page.locator('.individual-heat-row').nth(1).locator('.individual-competitor-card:not(.individual-lane-placeholder)');
      await expect(cards).toHaveCount(4);
      const clipped = await cards.evaluateAll((els) => els.filter((c) => {
        const content = [...c.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
        // the watermark hangs below the title on purpose, and the previous PB badge is visually hidden on a narrow screen: only the real content has to fit
        const overflows = (child: Element) => [...child.querySelectorAll('*')].some((el) => !el.closest('.individual-watermark, .individual-pb-current') && el.getBoundingClientRect().bottom > child.getBoundingClientRect().bottom + 1);
        return content > c.getBoundingClientRect().height + 1 || [...c.children].some(overflows);
      }).length);
      expect(clipped).toBe(0);
    });
  }
});

test('a finished race shows no rings around its laps, a running one keeps them on all its laps', async ({ page }) => {
  await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
  const ring = (card: import('@playwright/test').Locator) =>
    card.locator('.individual-compact-ringed').evaluateAll((els) => els.map((el) => getComputedStyle(el, '::after').opacity));
  const finished = page.locator('.individual-competitor-card.race-finished').first();
  await expect(finished).toBeVisible();
  await expect.poll(async () => (await ring(finished)).every((o) => o === '0')).toBe(true);
  const running = page.locator('.individual-competitor-card:not(.race-finished):has(.individual-compact-latest)').first();
  if (await running.count()) expect((await ring(running)).every((o) => o === '1')).toBe(true);
});

test.describe('lap times over more than one row', () => {
  test('only the latest shows until a tap shows all of them for five seconds', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(heatUrl('e2e-lanes', 'dist-500', 1));
    const body = page.locator('.individual-compact-body').first();
    await expect(body).toBeVisible({ timeout: 15_000 });
    // no fixture race is long enough to wrap: add laps to the first card until it needs more rows
    await body.evaluate((b) => {
      const laps = [...b.querySelectorAll('.individual-compact-lap')];
      laps.forEach((lap) => lap.classList.remove('individual-lap-latest'));
      const template = laps[0];
      for (let i = 0; i < 12; i++) b.appendChild(template.cloneNode(true));
      b.lastElementChild!.classList.add('individual-lap-latest');
    });
    const visible = () => body.evaluate((b) => [...b.querySelectorAll('.individual-compact-lap')].filter((lap) => getComputedStyle(lap).display !== 'none').length);
    await expect.poll(visible).toBe(1);
    await body.click();
    await expect.poll(visible).toBeGreaterThan(10);
    await expect.poll(visible, { timeout: 8000 }).toBe(1);
  });
});
