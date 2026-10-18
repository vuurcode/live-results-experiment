import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { distanceAtLap, leaderLaps, massStartLapCount, racesAtLap } from './mass-lap.util';

function race(id: string, laps: string[], over: Partial<CompetitorUpdate> = {}): CompetitorUpdate {
  return { id, name: id, lap_times: laps, laps_count: laps.length, total_time: '', finished_rank: null, ...over } as CompetitorUpdate;
}

describe('racesAtLap', () => {
  it('orders the racers by the laps up to that lap, and leaves the live racers alone', () => {
    const a = race('a', ['30.000', '31.000', '30.000'], { total_time: '1:31.000' });
    const b = race('b', ['29.000', '33.000', '29.000'], { total_time: '1:31.000' });
    const after1 = racesAtLap([a, b], 1, 3);
    expect(after1.map((r) => r.id)).toEqual(['b', 'a']);
    expect(after1[0]).toMatchObject({ laps_count: 1, total_time: '29.000', laps_remaining: 2, position: 1 });
    const after2 = racesAtLap([a, b], 2, 3);
    expect(after2.map((r) => r.id)).toEqual(['a', 'b']);
    expect(after2[0].total_time).toBe('1:01.000');
    expect(a.lap_times).toHaveLength(3);
  });

  it('keeps the finish after the last lap and puts a racer who has skated less behind', () => {
    const a = race('a', ['30.000', '30.000'], { total_time: '1:00.000', finished_rank: 1 });
    const b = race('b', ['31.000'], { total_time: '31.000' });
    const final = racesAtLap([b, a], 2, 2);
    expect(final.map((r) => [r.id, r.finished_rank, r.total_time])).toEqual([['a', 1, '1:00.000'], ['b', null, '31.000']]);
    expect(racesAtLap([b, a], 2, null).map((r) => r.laps_count)).toEqual([2, 1]);
  });
});

describe('mass start laps', () => {
  const distance = { totalLaps: 5, anyFinished: false, finishingLineAfter: null, processedRaces: [race('a', ['30.000', '30.000']), race('b', ['30.000'])] } as unknown as ProcessedDistance;

  it('counts the laps and the laps of the leader', () => {
    expect(massStartLapCount(distance)).toBe(5);
    expect(massStartLapCount({ ...distance, totalLaps: null })).toBe(2);
    expect(leaderLaps(distance)).toBe(2);
  });

  it('groups the standings after a lap', () => {
    const view = distanceAtLap(distance, 1, 1, 3, (n) => (n === 1 ? 'lap' : 'laps'));
    expect(view.standingsGroups).toHaveLength(1);
    expect(view.standingsGroups[0].races).toHaveLength(2);
  });
});
