import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { distanceCompleted, hideDisqualifications } from './hide-dq.util';

function race(id: string, over: Partial<CompetitorUpdate> = {}): CompetitorUpdate {
  return { id, laps_count: 0, lap_times: [], invalid_reason: null, remark: null, ...over } as CompetitorUpdate;
}

function distance(races: CompetitorUpdate[]): ProcessedDistance {
  return { id: 'd', name: '500m', eventNumber: 1, isLive: true, isMassStart: false, distanceMeters: 500, totalLaps: null, anyFinished: false, finishingLineAfter: null, processedRaces: races, standingsGroups: [], heatGroups: [{ heat: 1, raceIds: races.map((r) => r.id), races }] } as ProcessedDistance;
}

describe('hideDisqualifications', () => {
  it('drops DQ from the reason and the remark, and keeps other codes', () => {
    const d = hideDisqualifications(distance([race('a', { invalid_reason: 'DQ' }), race('b', { remark: 'PR DQ' }), race('c', { invalid_reason: 'DNS' })]));
    expect(d.processedRaces.map((r) => [r.invalid_reason, r.remark])).toEqual([[null, null], [null, 'PR'], ['DNS', null]]);
    expect(d.heatGroups[0].races.map((r) => r?.invalid_reason)).toEqual([null, null, 'DNS']);
  });

  it('is complete only when every race has a result or a status', () => {
    expect(distanceCompleted(distance([race('a', { invalid_reason: 'DQ' }), race('b')]))).toBe(false);
    expect(distanceCompleted(distance([race('a', { invalid_reason: 'DQ' }), race('b', { laps_count: 99 })]))).toBe(true);
  });
});
