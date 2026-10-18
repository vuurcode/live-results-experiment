import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { rankDistance } from './ranking.util';

function race(id: string, laps: number, time: string, extra: Partial<CompetitorUpdate> = {}): CompetitorUpdate {
  return { id, name: id, laps_count: laps, total_time: time, finished_rank: null, invalid_reason: null, lap_times: [], ...extra } as CompetitorUpdate;
}

function distance(races: CompetitorUpdate[], extra: Partial<ProcessedDistance> = {}): ProcessedDistance {
  return { id: 'd', isMassStart: false, distanceMeters: 500, processedRaces: races, ...extra } as ProcessedDistance;
}

describe('rankDistance', () => {
  it('orders the finished by time with the gap to the first and puts racers on the track last', () => {
    const rows = rankDistance(distance([race('b', 2, '40.500'), race('c', 1, '20.000'), race('a', 2, '39.000')]));
    expect(rows.map((r) => [r.race.id, r.rank, r.gap, r.live])).toEqual([['a', 1, '', false], ['b', 2, '+1.500', false], ['c', null, '', true]]);
  });

  it('shows no time for a racer still on the track', () => {
    const rows = rankDistance(distance([race('a', 2, '0:40.000', { finished_rank: 1 }), race('c', 1, '0:20.000')]));
    expect(rows.find((r) => r.race.id === 'c')?.time).toBe('');
  });

  it('gives equal times the same place', () => {
    const rows = rankDistance(distance([race('a', 2, '39.000'), race('b', 2, '39.000'), race('c', 2, '40.000')]));
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('puts competitors that have not started, then invalid results, last without a place', () => {
    const rows = rankDistance(distance([race('a', 2, '39.000', { invalid_reason: 'DSQ' }), race('b', 0, ''), race('c', 2, '41.000')]));
    expect(rows.map((r) => [r.race.id, r.rank, r.unranked, r.reason])).toEqual([['c', 1, false, null], ['b', null, true, null], ['a', null, true, 'DSQ']]);
  });

  it('orders a mass start by finishing rank', () => {
    const rows = rankDistance(distance([race('a', 5, '8:01.000', { finished_rank: 2 }), race('b', 5, '8:00.000', { finished_rank: 1 }), race('c', 4, '6:00.000')], { isMassStart: true, distanceMeters: null }));
    expect(rows.map((r) => [r.race.id, r.rank, r.gap, r.live])).toEqual([['b', 1, '', false], ['a', 2, '+1.000', false], ['c', null, '', true]]);
  });
});
