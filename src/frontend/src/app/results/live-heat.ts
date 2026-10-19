import { CompetitorUpdate } from './data.models';
import { isNeverLive } from './race-codes';

/** Where the live heat is among the heats of a distance, and when its laps last changed. */
export interface LiveHeat {
  index: number;
  updatedAt: number;
}

/**
 * The last heat, in the order of the event, that has laps timed here: a late change to an earlier heat (a corrected lap
 * time) never takes the live position back. Heats that were never timed here, or hold only competitors who are not on
 * the ice, are never live. Both the live marker and the page's following use this rule, so the page scrolls to the heat
 * it marks.
 */
export function findLiveHeat(heats: { races: (CompetitorUpdate | null)[] }[]): LiveHeat | null {
  let live: LiveHeat | null = null;
  heats.forEach((heat, index) => heat.races.forEach(race => {
    if (race?.lapsUpdatedAt && !isNeverLive(race) && (live?.index !== index || race.lapsUpdatedAt > live.updatedAt)) {
      live = { index, updatedAt: race.lapsUpdatedAt };
    }
  }));
  return live;
}
