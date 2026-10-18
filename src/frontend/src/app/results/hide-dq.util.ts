import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { individualRaceComplete } from './heats.util';
import { RaceCode } from './race-codes';

/** The race without its disqualification, as if the jury had not ruled yet. */
function withoutDq(race: CompetitorUpdate): CompetitorUpdate {
  const remark = race.remark?.trim().split(/\s+/).filter((c) => c.toUpperCase() !== RaceCode.Disqualified).join(' ') || null;
  const invalid = race.invalid_reason?.toUpperCase() === RaceCode.Disqualified ? null : race.invalid_reason;
  return invalid === race.invalid_reason && remark === (race.remark?.trim() || null) ? race : { ...race, invalid_reason: invalid, remark };
}

/** True when every race of an individual distance has its result or a status, so the disqualifications are final. */
export function distanceCompleted(distance: ProcessedDistance): boolean {
  const total = distance.processedRaces.length;
  return !!distance.distanceMeters && total > 0 && distance.processedRaces.every((race) => individualRaceComplete(race, distance.distanceMeters!));
}

/** A distance that is still under way, with the disqualifications of its races left out; they show once the whole distance is completed. */
export function hideDisqualifications(distance: ProcessedDistance): ProcessedDistance {
  if (distance.isMassStart) return distance;
  const hide = (race: CompetitorUpdate | null) => (race ? withoutDq(race) : race);
  return {
    ...distance,
    processedRaces: distance.processedRaces.map((race) => withoutDq(race)),
    heatGroups: distance.heatGroups.map((group) => ({ ...group, races: group.races.map(hide) })),
  };
}
