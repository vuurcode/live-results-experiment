import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate, ProcessedDistance } from './data.models';
import { newFinishers } from './finish-announce.util';

const race = (id: string, laps: number, over: Partial<CompetitorUpdate> = {}) => ({ id, name: `Skater ${id}`, laps_count: laps, formatted_total_time: laps >= 1 ? '35.5' : '', invalid_reason: null, ...over }) as CompetitorUpdate;
const distance = (races: CompetitorUpdate[], over: Partial<ProcessedDistance> = {}) => ({ id: 'd', isMassStart: false, distanceMeters: 500, processedRaces: races, ...over }) as ProcessedDistance;

describe('newFinishers', () => {
  it('names the skaters whose result came in since the previous data', () => {
    const before = [distance([race('a', 1), race('b', 0)])];
    const after = [distance([race('a', 1), race('b', 99)])];
    expect(newFinishers(before, after).map((r) => r.id)).toEqual(['b']);
  });

  it('announces nothing for the first data, a distance that was not there, a mass start or a disqualification', () => {
    const done = [distance([race('a', 99)])];
    expect(newFinishers(null, done)).toEqual([]);
    expect(newFinishers([], done)).toEqual([]);
    expect(newFinishers([distance([race('a', 0)], { isMassStart: true })], [distance([race('a', 99)], { isMassStart: true })])).toEqual([]);
    expect(newFinishers([distance([race('a', 0)])], [distance([race('a', 99, { invalid_reason: 'DQ' })])])).toEqual([]);
  });
});
