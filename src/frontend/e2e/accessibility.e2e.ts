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

// Badges ease between colours for over a second; axe must not measure a colour half way between two.
async function settleTransitions(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => undefined))),
  );
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

      const { violations } = await new AxeBuilder({ page }).exclude('.peek').withTags(TAGS).analyze(); // the peeks are aria-hidden hints at the neighbouring heats, faint on purpose
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
  const { violations } = await new AxeBuilder({ page }).exclude('.peek').withTags(TAGS).analyze();
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
