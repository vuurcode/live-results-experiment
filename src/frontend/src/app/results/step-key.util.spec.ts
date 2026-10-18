import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { buildSteps } from '../dashboard/heat-steps';
import { heatStepKey, raceStepKey } from './step-key.util';

const race = (id: string, lane: string) => ({ id, name: id, lane, lap_times: [], laps_count: 0, finished_rank: null }) as unknown as CompetitorUpdate;

function distance(): ProcessedDistance {
  return {
    id: 'd', isMassStart: false,
    heatGroups: [
      { heat: 1, races: [race('a', 'white'), race('b', 'red')] },
      { heat: 2, races: [race('c', 'yellow'), race('e', 'blue')] },
      { heat: 3, races: [race('f', 'white'), null] },
    ],
  } as unknown as ProcessedDistance;
}

describe('heatStepKey', () => {
  it('names the heat', () => expect(heatStepKey(distance(), 2)).toBe('d:3'));
  it('names the first heat of a quartet for its yellow and blue half', () => expect(heatStepKey(distance(), 1)).toBe('d:1'));
});

describe('raceStepKey', () => {
  it('names the step of the heat of the racer', () => expect(raceStepKey(distance(), 'c')).toBe('d:1'));
});

describe('mass start step keys', () => {
  const mass = {
    id: 'm', isMassStart: true, totalLaps: 4, heatGroups: [{ heat: 1, races: [race('a', 'white')] }],
    processedRaces: [{ laps_count: 4 }],
  } as unknown as ProcessedDistance;

  it('names the first lap for a heat and the last lap for a racer', () => {
    expect(heatStepKey(mass, 0)).toBe('m:lap:1');
    expect(raceStepKey(mass, 'a')).toBe('m:lap:4');
  });
});

describe('step keys against the slider steps', () => {
  it('are keys of the steps the slider has', () => {
    const quartet = distance();
    quartet.name = 'Quartet';
    (quartet as { processedRaces: CompetitorUpdate[] }).processedRaces = quartet.heatGroups.flatMap((g) => g.races.filter((r) => r !== null));
    (quartet as { eventNumber: number }).eventNumber = 1;
    const mass = { id: 'm', name: 'Mass', eventNumber: 2, isMassStart: true, totalLaps: 3, heatGroups: [{ heat: 1, races: [race('x', 'white')] }], processedRaces: [{ laps_count: 3, lap_times: [], id: 'x', name: 'x' }] } as unknown as ProcessedDistance;
    const keys = buildSteps([quartet, mass], (n) => `Heat ${n}`, (n) => `Lap ${n}`).steps.map((step) => step.key);
    const wanted = [heatStepKey(quartet, 0), heatStepKey(quartet, 1), heatStepKey(quartet, 2), raceStepKey(quartet, 'e'), heatStepKey(mass, 0), raceStepKey(mass, 'x')];
    for (const key of wanted) expect(keys).toContain(key);
  });
});
