import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { massStartLapCount } from './mass-lap.util';

const isQuartetLane = (race: CompetitorUpdate | null): boolean => race?.lane === 'yellow' || race?.lane === 'blue';

/**
 * The key of the heat slider step that shows a heat: that of its first heat when it is the yellow and blue half of a
 * quartet, and for a mass start the first or last lap. Matches the keys of the slider's steps.
 */
export function heatStepKey(distance: ProcessedDistance, heatIndex: number, lap: 'first' | 'last' = 'first'): string {
  if (distance.isMassStart) return `${distance.id}:lap:${lap === 'first' ? 1 : massStartLapCount(distance)}`;
  const groups = distance.heatGroups;
  let start = heatIndex;
  if (start > 0 && groups[start].races.some(isQuartetLane) && !groups[start - 1].races.some(isQuartetLane)) start -= 1;
  return `${distance.id}:${groups[start].heat}`;
}

/** The step key for a racer: that of their heat, or for a mass start its last lap, where the final order stands. */
export function raceStepKey(distance: ProcessedDistance, raceId: string): string {
  const index = distance.heatGroups.findIndex((group) => group.races.some((race) => race?.id === raceId));
  return heatStepKey(distance, Math.max(0, index), 'last');
}
