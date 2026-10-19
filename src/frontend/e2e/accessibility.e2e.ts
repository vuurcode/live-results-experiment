import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { MOCK_URL } from './env';

// Same rule set as .claude/skills/accessibility/scripts/axe-scan.mjs
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function restartReplay(request: import('@playwright/test').APIRequestContext, competition: string) {
  const res = await request.post(`${MOCK_URL}/api/reset`, { params: { competitionId: competition } });
  expect(res.ok()).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 800));
}

// Badges ease between colours for over a second, and a replay that is still arriving starts new transitions; axe must
// not measure a colour half way between two. Wait until no finite animation has run for a few frames.
async function settleTransitions(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const finite = () => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    for (let quiet = 0; quiet < 5; ) {
      const running = finite();
      if (running.length) {
        quiet = 0;
        await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      } else quiet++;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  });
}

test.describe('accessibility', () => {
  for (const [competition, ready, scheme] of [
    ['e2e-individual', '.individual-compact-done', 'light'], // finished cards show the total time badge
    ['e2e-mass', '.race-item-laps.race-finished', 'light'],
    ['e2e-individual', '.individual-compact-done', 'dark'],
    ['e2e-mass', '.race-item-laps.race-finished', 'dark'],
  ] as const) {
    test(`${competition} (${scheme}): no axe violations once the replay has finished`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await restartReplay(request, competition);
      await page.goto(`/?competitionId=${competition}`);
      // finished rows are the last state of the replay, with every badge and row on screen
      await expect(page.locator(ready).first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-coreui-theme', scheme);
      await settleTransitions(page);

      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`),
      ).toEqual([]);
    });
  }

  test('the event name is the page heading', async ({ page, request }) => {
    await restartReplay(request, 'e2e-individual');
    await page.goto('/?competitionId=e2e-individual');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Individual Event');
  });

  test('a competitor row can be selected with the keyboard alone', async ({ page, request }) => {
    await restartReplay(request, 'e2e-mass');
    await page.goto('/?competitionId=e2e-mass');
    await expect(page.locator('.race-item-laps.race-finished').first()).toBeVisible();

    const row = page.getByRole('button', { name: /Competitor G/ });
    await row.focus();
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(row).toHaveAttribute('aria-pressed', 'false');
  });
});

test('the open menu has no axe violations', async ({ page, request }) => {
  await restartReplay(request, 'e2e-individual');
  await page.goto('/?competitionId=e2e-individual');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#mainMenu')).toBeVisible();
  await settleTransitions(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

for (const competition of ['e2e-individual', 'e2e-mass']) {
  test(`the settings page of ${competition} has no axe violations`, async ({ page, request }) => {
    await restartReplay(request, competition);
    await page.goto(`/settings?competitionId=${competition}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await settleTransitions(page);
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
}

test('the heat slider is a labelled range input', async ({ page, request }) => {
  await restartReplay(request, 'e2e-individual');
  await page.goto('/?competitionId=e2e-individual');
  const slider = page.getByRole('slider');
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAccessibleName(/.+/);
});

test('a visitor who asks for less motion gets no running animations or transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?competitionId=e2e-individual');
  await expect(page.locator('.individual-competitor-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && !(a.effect as KeyframeEffect | null)?.target?.closest('c-offcanvas, [cPlaceholder]')).map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty} on ${(a.effect as KeyframeEffect | null)?.target?.className}`));
  expect(running).toEqual([]);
  // the page-wide rule, not only the guards of the components: any element is stilled
  const probe = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.cssText = 'animation: spin 1s infinite; transition: opacity 1s';
    document.body.append(el);
    const { animationName, transitionDuration } = getComputedStyle(el);
    el.remove();
    return { animationName, transitionDuration };
  });
  expect(probe).toEqual({ animationName: 'none', transitionDuration: '0s' });
});

test('a finish is announced in a polite live region, and the routine lap times are not', async ({ page, request }) => {
  await restartReplay(request, 'e2e-individual');
  await page.goto('/?competitionId=e2e-individual');
  const region = page.locator('[aria-live="polite"]');
  await expect(region).toHaveCount(1);
  await expect(region).toHaveText(/finished/, { timeout: 60_000 });
  await expect(region).not.toHaveText(/\d+m\b/);
});

test('the keyboard reaches every control, each with a visible focus indicator, and Escape closes the menu', async ({ page }) => {
  await page.goto('/?competitionId=e2e-individual');
  await expect(page.locator('.individual-competitor-card').first()).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // the range input's own thumb is invisible; the dot drawn for it carries the ring
      const s = getComputedStyle(el instanceof HTMLInputElement && el.type === 'range' ? el.parentElement!.querySelector('.thumb-dot')! : el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      return { name: el.getAttribute('aria-label') ?? el.id ?? el.className, ring };
    });
    if (!focus) continue;
    seen.push(focus.name);
    expect(focus.ring, `focus indicator on ${focus.name}`).toBe(true);
  }
  expect(seen.length).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Menu' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Ranking' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Ranking' })).toBeHidden();
});

test('text spacing set by the visitor causes no horizontal scroll and no clipped lap badges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?competitionId=e2e-individual');
  await expect(page.locator('.individual-competitor-card').first()).toBeVisible();
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }' });
  await page.waitForTimeout(300);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
