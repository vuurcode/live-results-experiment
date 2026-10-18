import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { isIndividualFinished } from './heats.util';

/**
 * The skaters of an individual distance who have finished since the previous data: a result in the data and not in
 * the one before. A distance that was not there before is a replay arriving, not a finish, and announces nothing.
 */
export function newFinishers(previous: ProcessedDistance[] | null, next: ProcessedDistance[]): CompetitorUpdate[] {
  if (!previous) return [];
  const done = (race: CompetitorUpdate, distance: ProcessedDistance) => !race.invalid_reason && !!race.formatted_total_time && isIndividualFinished(race, distance.distanceMeters!);
  return next.flatMap((distance) => {
    const before = previous.find((d) => d.id === distance.id);
    if (!before || distance.isMassStart || !distance.distanceMeters) return [];
    const finished = new Set(before.processedRaces.filter((race) => done(race, before)).map((race) => race.id));
    return distance.processedRaces.filter((race) => done(race, distance) && !finished.has(race.id));
  });
}
