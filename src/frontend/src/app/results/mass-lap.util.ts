import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { recomputeGroups, recomputePositions } from './standings.util';
import { formatDurationSeconds, parseSeconds } from './time.util';

/** The laps of a mass start: its length when known, else what the leader has skated, and at least one. */
export function massStartLapCount(distance: ProcessedDistance): number {
  return Math.max(1, distance.totalLaps ?? 0, ...distance.processedRaces.map((race) => race.laps_count));
}

/** The laps the leader of a mass start has completed. */
export function leaderLaps(distance: ProcessedDistance): number {
  return Math.max(0, ...distance.processedRaces.map((race) => race.laps_count));
}

/**
 * The racers of a mass start as the standings stood after `lap` laps: each racer's laps cut off at `lap`, the total
 * time that of the laps left, sorted by laps and time. A racer who has not skated `lap` laps keeps the laps skated.
 * The racers are copies, so the live ones are left alone. After the last lap the finish is as it was.
 */
export function racesAtLap(races: CompetitorUpdate[], lap: number, totalLaps: number | null): CompetitorUpdate[] {
  const final = totalLaps !== null && lap >= totalLaps;
  const copies = races.map((race): CompetitorUpdate => {
    if (final) return { ...race, position_change: null };
    const lapTimes = race.lap_times.slice(0, lap);
    const millis = Math.round(lapTimes.reduce((sum, time) => sum + parseSeconds(time), 0) * 1000);
    const total = lapTimes.length > 0 ? formatDurationSeconds((millis + 0.5) / 1000) : '';
    return {
      ...race,
      lap_times: lapTimes,
      laps_count: lapTimes.length,
      total_time: total,
      formatted_total_time: total,
      laps_remaining: totalLaps === null ? null : Math.max(0, totalLaps - lapTimes.length),
      is_final_lap: totalLaps !== null && totalLaps - lapTimes.length === 1,
      finished_rank: null,
      remark: null, // records and bests are the result of the whole race
      position: 0,
      position_change: null,
      group_number: null,
      gap_to_above: null,
    };
  });
  return recomputePositions(copies);
}

/** The mass start as the standings stood after `lap` laps, with its groups, ready to render as the distance is. */
export function distanceAtLap(distance: ProcessedDistance, lap: number, threshold: number, maxGroups: number, lapUnit: (n: number) => string): ProcessedDistance {
  const processedRaces = racesAtLap(distance.processedRaces, lap, distance.totalLaps);
  const final = distance.totalLaps !== null && lap >= distance.totalLaps;
  const standingsGroups = recomputeGroups(processedRaces, threshold, maxGroups, lapUnit);
  return { ...distance, processedRaces, standingsGroups, anyFinished: final && distance.anyFinished, finishingLineAfter: final ? distance.finishingLineAfter : null };
}
