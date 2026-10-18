import type { CompetitorUpdate, ProcessedDistance } from '../results/data.models';
import { emptyLaneColor, pairHeatGroups, type MergedHeatGroup } from '../results/heats.util';
import { leaderLaps, massStartLapCount, racesAtLap } from '../results/mass-lap.util';
import { RaceCode, RECORD_CODES, RECORD_PRIORITY } from '../results/race-codes';

/** A racer as the slider preview lists them. */
export interface StepRacer {
  name: string;
  lane: string | null;
  /** The remark and invalid reason codes of the racer, as the card shows them */
  badges: { code: string; kind: 'purple' | 'orange' | 'red' }[];
}

/** A lane of a heat: the racer in it, if any, and its colour. */
export interface StepSlot {
  racer: StepRacer | null;
  lane: string | null;
}

/** One stop of the slider: a heat of a distance, or the standings of a mass start after a lap. */
export interface HeatStep {
  /** Identifies the step across data updates: the distance and the number of its first heat, which heats coming or going do not change */
  key: string;
  distanceId: string;
  distanceName: string;
  eventNumber: number;
  /** The length of the distance in meters, when known */
  distanceMeters: number | null;
  isMassStart: boolean;
  /** Indexes into the distance's heat groups: one heat, the two pairs of a quartet, none for a mass start */
  heatIndexes: number[];
  /** The lap of a mass start the standings are after; null for a heat */
  lap: number | null;
  /** The label of the heat, those of a quartet's pairs joined, or of the lap of a mass start */
  label: string;
  racers: StepRacer[];
  /** The slots of the heats in lane order, the empty ones included, with the colour of their lane; a mass start has none */
  slots: StepSlot[];
  /** Racers a mass start preview names at most */
  more: number;
  /** The record codes (WR, NR, TR, TRC, PR) the racers of the step have, the most significant first */
  records: string[];
  /** The most significant record code of each racer that has one, so a step with several record racers can show a line for each */
  racerRecords: string[];
  /** The fault code (DQ, FL, DNF) of each racer that has one, for a short line on the slider */
  faults: string[];
}

/** The mass start racers a preview names; the rest is counted. */
export const MASS_START_PREVIEW = 5;

/** The record codes in the remarks of the races, the most significant first. */
function recordsOf(races: (CompetitorUpdate | null)[]): string[] {
  const codes = new Set(races.flatMap((race) => race?.remark?.toUpperCase().split(/\s+/) ?? []));
  return [...RECORD_PRIORITY, RaceCode.PersonalRecord].filter((code) => codes.has(code));
}

/** The most significant record code of each race that has one. */
function racerRecordsOf(races: (CompetitorUpdate | null)[]): string[] {
  return races.flatMap((race) => recordsOf([race]).slice(0, 1));
}

const FAULT_CODES: ReadonlySet<string> = new Set<string>([RaceCode.Disqualified, RaceCode.Fall, RaceCode.DidNotFinish]);

/** The fault code of each race that has one, a disqualification first. */
function faultsOf(races: (CompetitorUpdate | null)[]): string[] {
  return races.flatMap((race) => {
    if (!race) return [];
    const codes = [race.invalid_reason, ...(race.remark?.trim().split(/\s+/) ?? [])].filter((c): c is string => !!c).map((c) => c.toUpperCase());
    const code = codes.find((c) => c === RaceCode.Disqualified) ?? codes.find((c) => FAULT_CODES.has(c));
    return code ? [code] : [];
  });
}

function started(races: (CompetitorUpdate | null)[]): boolean {
  return races.some((race) => race !== null && (race.lap_times.length > 0 || race.finished_rank != null));
}

/**
 * The stops of the slider, in the order of the event: every heat of every distance and every lap of a mass start, the
 * ones still to come included. `live` is the index of the newest heat that has been timed, or the lap the leader of
 * a mass start has completed; a distance that is live without a timed heat yet puts it on its first heat. `labelFor`
 * names a heat and `lapLabelFor` a lap.
 */
export function buildSteps(distances: ProcessedDistance[], labelFor: (heat: number) => string, lapLabelFor: (lap: number) => string): { steps: HeatStep[]; live: number } {
  const all: HeatStep[] = [];
  let last = -1;
  for (const distance of [...distances].sort((a, b) => a.eventNumber - b.eventNumber)) {
    const base = { distanceId: distance.id, distanceName: distance.name, eventNumber: distance.eventNumber, distanceMeters: distance.distanceMeters, isMassStart: distance.isMassStart };
    if (distance.isMassStart) {
      const laps = massStartLapCount(distance);
      const reached = Math.min(laps, Math.max(1, leaderLaps(distance)));
      if (distance.isLive || started(distance.processedRaces)) last = all.length + reached - 1;
      for (let lap = 1; lap <= laps; lap++) {
        const races = racesAtLap(distance.processedRaces, lap, distance.totalLaps);
        const final = lap === laps;
        all.push({ ...base, key: `${distance.id}:lap:${lap}`, heatIndexes: [], lap, label: lapLabelFor(lap), racers: races.slice(0, MASS_START_PREVIEW).map(racer), slots: [], more: Math.max(0, races.length - MASS_START_PREVIEW), records: final ? recordsOf(races) : [], racerRecords: final ? racerRecordsOf(races) : [], faults: [] });
      }
      continue;
    }
    for (const heats of quartets(pairHeatGroups(distance.heatGroups, labelFor))) {
      const races = heats.flatMap(({ group }) => group.races);
      if (started(races)) last = all.length;
      else if (distance.isLive && last < all.length && !all.some((s) => s.distanceId === distance.id)) last = all.length;
      all.push({ ...base, key: `${distance.id}:${distance.heatGroups[heats[0].index].heat}`, heatIndexes: heats.map(({ index }) => index), lap: null, label: heatsLabel(heats.map(({ group, index }) => ({ label: group.label, heat: distance.heatGroups[index].heat }))), racers: races.filter((r) => r !== null).map(racer), slots: heats.flatMap(({ group }) => group.races.map((race, slot) => ({ racer: race ? racer(race) : null, lane: race?.lane || emptyLaneColor(group.races, slot) }))), more: 0, records: recordsOf(races), racerRecords: racerRecordsOf(races), faults: faultsOf(races) });
    }
  }
  return { steps: all, live: Math.max(last, 0) };
}

/** The label of a heat, or "Heat 1 & 2" for the heats of a quartet. */
function heatsLabel(groups: { label: string; heat: number }[]): string {
  return [groups[0].label, ...groups.slice(1).map((group) => group.heat)].join(' & ');
}

/** Whether a heat is skated by the yellow and blue lanes, the second pair of a quartet. */
function hasQuartetLanes(group: MergedHeatGroup<CompetitorUpdate>): boolean {
  return group.races.some((r) => r?.lane === 'yellow' || r?.lane === 'blue');
}

/** The heats grouped as skated: a heat on the yellow and blue lanes joins the white and red heat before it, as the four lanes of one quartet. */
function quartets(groups: MergedHeatGroup<CompetitorUpdate>[]): { group: MergedHeatGroup<CompetitorUpdate>; index: number }[][] {
  const out: { group: MergedHeatGroup<CompetitorUpdate>; index: number }[][] = [];
  groups.forEach((group, index) => {
    if (index > 0 && hasQuartetLanes(group) && !hasQuartetLanes(groups[index - 1])) out[out.length - 1].push({ group, index });
    else out.push([{ group, index }]);
  });
  return out;
}

function racer(race: CompetitorUpdate): StepRacer {
  const remarks = race.remark?.trim().split(/\s+/).filter(Boolean) ?? [];
  const badges = [
    ...(race.invalid_reason ? [{ code: race.invalid_reason, kind: race.invalid_reason.toUpperCase() === RaceCode.Disqualified ? ('red' as const) : ('orange' as const) }] : []),
    ...remarks.map((code) => ({ code, kind: code.toUpperCase() === RaceCode.PersonalRecord || RECORD_CODES.has(code.toUpperCase()) ? ('purple' as const) : ('orange' as const) })),
  ];
  return { name: race.name, lane: race.lane || null, badges };
}
