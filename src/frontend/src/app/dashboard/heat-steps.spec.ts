import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from '../results/data.models';
import { buildSteps } from './heat-steps';

const label = (n: number) => `Heat ${n}`;
const lapLabel = (n: number) => `Lap ${n}`;

function race(id: string, laps: string[] = [], over: Partial<CompetitorUpdate> = {}): CompetitorUpdate {
  return { id, name: `Skater ${id}`, lane: 'white', lap_times: laps, laps_count: laps.length, finished_rank: null, ...over } as CompetitorUpdate;
}

function distance(id: number, heats: CompetitorUpdate[][], over: Partial<ProcessedDistance> = {}): ProcessedDistance {
  return {
    id: `d${id}`, name: `Distance ${id}`, eventNumber: id, isLive: false, isMassStart: false, processedRaces: heats.flat(),
    heatGroups: heats.map((races, i) => ({ heat: i + 1, raceIds: races.map((r) => r.id), races })),
    ...over,
  } as ProcessedDistance;
}

describe('buildSteps', () => {
  it('lists the heats to come too, and is live at the newest heat that was timed', () => {
    const { steps, live } = buildSteps([distance(1, [[race('a', ['30.0'])], [race('b', ['31.0'])], [race('c')], [race('d')]])], label, lapLabel);
    expect(steps.map((s) => s.label, lapLabel)).toEqual(['Heat 1', 'Heat 2', 'Heat 3', 'Heat 4']);
    expect(live).toBe(1);
  });

  it('runs through the distances in event order and is live in the live one', () => {
    const { steps, live } = buildSteps([
      distance(2, [[race('c', ['35.0'])], [race('d')]], { isLive: true }),
      distance(1, [[race('a', [], { finished_rank: 1 })], [race('b', [], { finished_rank: 2 })]]),
      distance(3, [[race('e')]]),
    ], label, lapLabel);
    expect(steps.map((s) => `${s.eventNumber}:${s.label}`)).toEqual(['1:Heat 1', '1:Heat 2', '2:Heat 1', '2:Heat 2', '3:Heat 1']);
    expect(live).toBe(2);
  });

  it('puts the slider on the first heat of a live distance that has no laps yet', () => {
    const { steps, live } = buildSteps([distance(1, [[race('a', [], { finished_rank: 1 })]]), distance(2, [[race('b')], [race('c')]], { isLive: true })], label, lapLabel);
    expect(steps.map((s) => `${s.eventNumber}:${s.label}`)).toEqual(['1:Heat 1', '2:Heat 1', '2:Heat 2']);
    expect(live).toBe(1);
  });

  it('is live at the first heat when nothing was timed yet', () => {
    expect(buildSteps([distance(1, [[race('a')], [race('b')]])], label, lapLabel)).toMatchObject({ live: 0 });
    expect(buildSteps([], label, lapLabel)).toEqual({ steps: [], live: 0 });
  });

  it('lists the racers of a heat with their lanes', () => {
    const { steps } = buildSteps([distance(1, [[race('a', ['30.0']), race('b', ['31.0'], { lane: 'red' })]])], label, lapLabel);
    expect(steps[0].racers).toEqual([{ name: 'Skater a', lane: 'white', badges: [], heat: 'Heat 1' }, { name: 'Skater b', lane: 'red', badges: [], heat: 'Heat 1' }]);
  });

  it('gives a mass start a step for each lap, live at the lap the leader has completed', () => {
    const mass = distance(2, [], { isMassStart: true, isLive: true, totalLaps: 4, processedRaces: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => race(id, i === 0 ? ['40.0', '41.0'] : ['40.0'])) });
    const { steps, live } = buildSteps([distance(1, [[race('z', ['30.0'])]]), mass], label, lapLabel);
    expect(steps.map((s) => s.label)).toEqual(['Heat 1', 'Lap 1', 'Lap 2', 'Lap 3', 'Lap 4']);
    expect(live).toBe(2);
    expect(steps[1]).toMatchObject({ heatIndexes: [], lap: 1, more: 2 });
    expect(steps[1].racers).toHaveLength(5);
  });

  it('makes the white and red pair and the yellow and blue pair after it one step', () => {
    const wr = [race('a', ['30'], { lane: 'white' }), race('b', ['30'], { lane: 'red' })];
    const yb = [race('c', ['30'], { lane: 'yellow' }), race('d', ['30'], { lane: 'blue' })];
    const { steps } = buildSteps([distance(1, [wr, yb, [race('e', ['30'])]])], label, lapLabel);
    expect(steps.map((st) => st.heatIndexes)).toEqual([[0, 1], [2]]);
    expect(steps[0].racers.map((r) => r.lane)).toEqual(['white', 'red', 'yellow', 'blue']);
    expect(steps[0].racers.map((r) => r.heat)).toEqual(['Heat 1', 'Heat 1', 'Heat 2', 'Heat 2']);
  });

  it('gives a racer the badges of the remark and the invalid reason', () => {
    const { steps } = buildSteps([distance(1, [[race('a', ['30'], { remark: 'PR TR', invalid_reason: 'DQ' }), race('b', ['30'], { remark: 'MT' })]])], label, lapLabel);
    expect(steps[0].racers[0].badges).toEqual([{ code: 'DQ', kind: 'red' }, { code: 'PR', kind: 'purple' }, { code: 'TR', kind: 'purple' }]);
    expect(steps[0].racers[1].badges).toEqual([{ code: 'MT', kind: 'orange' }]);
  });
});
