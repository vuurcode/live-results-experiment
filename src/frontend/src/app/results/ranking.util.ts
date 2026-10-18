import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { individualRaceComplete } from './heats.util';
import { formatDurationSeconds, parseSeconds } from './time.util';

export interface RankingRow {
  /** Place in the final order so far; null while the competitor is still racing. */
  rank: number | null;
  race: CompetitorUpdate;
  /** Total time, or the time so far while racing. */
  time: string;
  /** Time behind the first place ("+0.123"); empty for the first place and for racers still on the track. */
  gap: string;
  live: boolean;
  /** No place: not started yet, or an invalid result */
  unranked: boolean;
  /** The reason of an invalid result (DSQ, DNS, ...) */
  reason: string | null;
}

/**
 * The final order so far of a distance: the competitors that have finished by time (mass start: by finishing rank),
 * with equal times sharing a place, followed by the ones still racing, then those without a place: not started yet,
 * then invalid results.
 */
export function rankDistance(distance: ProcessedDistance): RankingRow[] {
  const valid = distance.processedRaces.filter((race) => !race.invalid_reason);
  const finished = distance.isMassStart
    ? valid.filter((race) => race.finished_rank != null).sort((a, b) => a.finished_rank! - b.finished_rank!)
    : valid.filter((race) => race.total_time && distance.distanceMeters != null && individualRaceComplete(race, distance.distanceMeters))
      .sort((a, b) => parseSeconds(a.total_time) - parseSeconds(b.total_time));
  const rows: RankingRow[] = [];
  finished.forEach((race, i) => {
    const previous = rows[i - 1];
    const tied = !distance.isMassStart && previous && previous.time === race.total_time;
    const first = rows[0];
    const gap = first && i > 0 && race.total_time && first.race.total_time
      ? `+${formatDurationSeconds(Math.max(0, parseSeconds(race.total_time) - parseSeconds(first.race.total_time)))}`
      : '';
    rows.push({ rank: tied ? previous.rank : (distance.isMassStart ? race.finished_rank : i + 1), race, time: race.total_time, gap, live: false, unranked: false, reason: null });
  });
  const done = new Set(finished);
  for (const race of valid) {
    if (done.has(race) || race.laps_count <= 0) continue;
    rows.push({ rank: null, race, time: '', gap: '', live: true, unranked: false, reason: null });
  }
  const waiting = distance.processedRaces.filter((race) => !race.invalid_reason && race.laps_count <= 0 && !done.has(race));
  const invalid = distance.processedRaces.filter((race) => race.invalid_reason);
  for (const race of [...waiting, ...invalid]) {
    rows.push({ rank: null, race, time: '', gap: '', live: false, unranked: true, reason: race.invalid_reason });
  }
  return rows;
}
