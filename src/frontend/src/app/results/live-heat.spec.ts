import { describe, expect, it } from 'vitest';
import { CompetitorUpdate } from './data.models';
import { findLiveHeat } from './live-heat';

const race = (lapsUpdatedAt?: number, extra: Partial<CompetitorUpdate> = {}) =>
  ({ lapsUpdatedAt, invalid_reason: null, remark: null, ...extra }) as CompetitorUpdate;

describe('findLiveHeat', () => {
  it('is none without heats or without timed laps', () => {
    expect(findLiveHeat([])).toBeNull();
    expect(findLiveHeat([{ races: [race(), null] }])).toBeNull();
  });
  it('is the last heat with timed laps, however long ago they changed', () => {
    expect(findLiveHeat([{ races: [race(5)] }, { races: [race(9), null] }, { races: [race(7)] }])).toEqual({ index: 2, updatedAt: 7 });
  });
  it('stays on the later heat when an earlier heat changes afterwards', () => {
    expect(findLiveHeat([{ races: [race(20)] }, { races: [race(5)] }])?.index).toBe(1);
  });
  it('takes the latest change within the heat', () => {
    expect(findLiveHeat([{ races: [race(5), race(9)] }])).toEqual({ index: 0, updatedAt: 9 });
  });
  it('ignores competitors who did not start or withdrew', () => {
    const heats = [{ races: [race(5)] }, { races: [race(9, { invalid_reason: 'DNS' }), race(8, { remark: 'WDR' })] }];
    expect(findLiveHeat(heats)).toEqual({ index: 0, updatedAt: 5 });
  });
});
