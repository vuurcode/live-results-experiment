import type { Page } from '@playwright/test';

/** The heat slider's range input; its keyboard moves a step at a time and Home/End go to the first/last heat. */
export const slider = (page: Page) => page.getByRole('slider');

export const openMenu = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true }).click();

/**
 * The address that opens a competition on a given heat of a distance, the way the start list and the ranking link to it.
 * The view then stays on that heat; following a replay it would move on to the live one.
 */
export const heatUrl = (competition: string, distanceId: string, heat: number) =>
  `/?competitionId=${competition}&heat=${encodeURIComponent(`${distanceId}:${heat}`)}`;

/** The address of the settings page of a competition. */
export const settingsUrl = (competition: string) => `/settings?competitionId=${competition}`;
