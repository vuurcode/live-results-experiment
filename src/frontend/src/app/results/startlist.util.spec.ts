import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { heatsAhead, heatsOfMatches, nameMatches, startListHeats, startListNames } from './startlist.util';

function race(name: string, lane: string, laps: number, extra: Partial<CompetitorUpdate> = {}): CompetitorUpdate {
  return { id: name, name, lane, laps_count: laps, invalid_reason: null, finished_rank: null, ...extra } as CompetitorUpdate;
}

const label = (n: number) => `Heat ${n}`;

function sprint(): ProcessedDistance {
  return {
    id: 'a', name: '500 m', eventNumber: 1, isMassStart: false, distanceMeters: 500,
    heatGroups: [
      { heat: 1, raceIds: [], races: [race('Ann', 'white', 2), race('Bo', 'red', 2)] },
      { heat: 2, raceIds: [], races: [race('Cy', 'white', 0), race('Di', 'red', 0)] },
      { heat: 3, raceIds: [], races: [race('Ann', 'red', 0), null] },
    ],
    processedRaces: [],
  } as unknown as ProcessedDistance;
}

describe('startListHeats', () => {
  it('lists the heats in order with their racers and whether they are done', () => {
    const heats = startListHeats([sprint()], label);
    expect(heats.map((h) => [h.label, h.done, h.racers.map((r) => `${r.name}:${r.lane}`)])).toEqual([
      ['Heat 1', true, ['Ann:white', 'Bo:red']],
      ['Heat 2', false, ['Cy:white', 'Di:red']],
      ['Heat 3', false, ['Ann:red']],
    ]);
  });
});

describe('startListHeats live', () => {
  it('marks a heat that has started and is not done', () => {
    const distance = sprint();
    distance.heatGroups[1].races = [race('Cy', 'white', 1), race('Di', 'red', 0)];
    expect(startListHeats([distance], label).map((h) => h.live)).toEqual([false, true, false]);
  });
});

describe('startListHeats quartets', () => {
  it('joins a yellow and blue heat to the white and red heat before it', () => {
    const distance = sprint();
    distance.heatGroups[1].races = [race('Cy', 'yellow', 0), race('Di', 'blue', 0)];
    expect(startListHeats([distance], label).map((h) => h.joins)).toEqual([null, 'a:1', null]);
  });
});

describe('startListHeats step keys', () => {
  it('names the slider step of each heat, a quartet half by the heat before it', () => {
    const distance = sprint();
    distance.heatGroups[1].races = [race('Cy', 'yellow', 0), race('Di', 'blue', 0)];
    expect(startListHeats([distance], label).map((h) => h.stepKey)).toEqual(['a:1', 'a:1', 'a:3']);
  });
});

describe('heatsAhead', () => {
  it('counts the heats not done before the next heat of the racer', () => {
    const heats = startListHeats([sprint()], label);
    expect(heatsAhead(heats, 'Ann')?.heat.label).toBe('Heat 3');
    expect(heatsAhead(heats, 'Ann')?.ahead).toBe(1);
    expect(heatsAhead(heats, 'Cy')?.ahead).toBe(0);
  });

  it('has nothing for a racer whose heats are done', () => {
    expect(heatsAhead(startListHeats([sprint()], label), 'Bo')).toBeNull();
  });
});

describe('startListNames', () => {
  it('lists each name once, sorted', () => {
    expect(startListNames(startListHeats([sprint()], label))).toEqual(['Ann', 'Bo', 'Cy', 'Di']);
  });
});

describe('heatsOfMatches', () => {
  it('keeps every heat of the matching racers, across the distances, and all heats for an empty query', () => {
    const heats = startListHeats([sprint()], label);
    expect(heatsOfMatches(heats, 'ann').map((h) => h.label)).toEqual(['Heat 1', 'Heat 3']);
    expect(heatsOfMatches(heats, '  ')).toHaveLength(3);
    expect(heatsOfMatches(heats, 'zzz')).toEqual([]);
  });

  it('matches words in any order, ignoring case and accents', () => {
    expect(nameMatches('José van Dijk', 'dijk JOSE')).toBe(true);
    expect(nameMatches('José van Dijk', 'piet')).toBe(false);
  });
});
