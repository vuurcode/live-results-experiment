import type { ProcessedDistance } from './data.models';
import { individualRaceComplete, pairHeatGroups } from './heats.util';
import { heatStepKey } from './step-key.util';

export interface StartListRacer {
  name: string;
  /** Lane colour; null in a mass start */
  lane: string | null;
}

/** One entry of the start list: a heat of an individual distance, or the single start of a mass start. */
export interface StartListHeat {
  /** Identifies the entry across updates */
  key: string;
  distanceId: string;
  distanceName: string;
  eventNumber: number;
  /** The key of the slider step that shows the heat */
  stepKey: string;
  /** The label of the heat; empty for a mass start */
  label: string;
  racers: StartListRacer[];
  /** Every racer of the heat has finished (or has an invalid result) */
  done: boolean;
  /** The key of the heat before it when the two are one quartet (this heat is skated on the yellow and blue lanes); null otherwise */
  joins: string | null;
  /** Skating now: someone has started and the heat is not done */
  live: boolean;
}

/** Every heat of every distance in the order of the event, the ones still to come included. */
export function startListHeats(distances: ProcessedDistance[], labelFor: (heat: number) => string): StartListHeat[] {
  const heats: StartListHeat[] = [];
  for (const distance of [...distances].sort((a, b) => a.eventNumber - b.eventNumber)) {
    const base = { distanceId: distance.id, distanceName: distance.name, eventNumber: distance.eventNumber };
    if (distance.isMassStart) {
      const racers = distance.processedRaces.filter((race) => !race.invalid_reason || race.laps_count > 0);
      heats.push({
        ...base,
        key: `${distance.id}:mass`,
        stepKey: heatStepKey(distance, 0),
        label: '',
        racers: racers.map((race) => ({ name: race.name, lane: null })),
        done: racers.length > 0 && racers.every((race) => race.finished_rank != null || !!race.invalid_reason),
        joins: null,
        live: false,
      });
      const mass = heats[heats.length - 1];
      mass.live = !mass.done && racers.some((race) => race.laps_count > 0);
      continue;
    }
    pairHeatGroups(distance.heatGroups, labelFor).forEach((group, i) => {
      const races = group.races.filter((race) => race !== null);
      const done = races.length > 0 && distance.distanceMeters != null && races.every((race) => individualRaceComplete(race, distance.distanceMeters!));
      heats.push({
        ...base,
        key: `${distance.id}:${distance.heatGroups[i].heat}`,
        stepKey: heatStepKey(distance, i),
        label: group.label,
        racers: races.map((race) => ({ name: race.name, lane: race.lane || null })),
        done,
        joins: null,
        live: !done && races.some((race) => race.laps_count > 0),
      });
    });
  }
  heats.forEach((heat, i) => {
    if (i > 0 && heats[i - 1].distanceId === heat.distanceId && hasQuartetLanes(heat) && !hasQuartetLanes(heats[i - 1])) heat.joins = heats[i - 1].key;
  });
  return heats;
}

function hasQuartetLanes(heat: StartListHeat): boolean {
  return heat.racers.some((racer) => racer.lane === 'yellow' || racer.lane === 'blue');
}

/** The next heat of the racer that is not done, with the number of heats not done before it in the event; null when they have none left. */
export function heatsAhead(heats: StartListHeat[], name: string): { heat: StartListHeat; ahead: number } | null {
  const index = heats.findIndex((heat) => !heat.done && heat.racers.some((racer) => racer.name === name));
  if (index < 0) return null;
  return { heat: heats[index], ahead: heats.slice(0, index).filter((heat) => !heat.done).length };
}

/** The names of all racers in the start list, sorted, each once. */
export function startListNames(heats: StartListHeat[]): string[] {
  return [...new Set(heats.flatMap((heat) => heat.racers.map((racer) => racer.name)))].sort((a, b) => a.localeCompare(b));
}

/** Lower case without accents, so that a search for "jose" finds "José". */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** True when the name contains every word of the query, in any order. */
export function nameMatches(name: string, query: string): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const target = plain(name);
  return words.length > 0 && words.every((word) => target.includes(word));
}

/** The heats with at least one racer matching the query, in the order of the event; all heats for an empty query. */
export function heatsOfMatches(heats: StartListHeat[], query: string): StartListHeat[] {
  if (!query.trim()) return heats;
  return heats.filter((heat) => heat.racers.some((racer) => nameMatches(racer.name, query)));
}
