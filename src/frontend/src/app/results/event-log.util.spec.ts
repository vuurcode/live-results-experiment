import { describe, expect, it } from 'vitest';
import type { CompetitorUpdate } from './data.models';
import { diffUpdate, isPastHeat, loadEventLog, saveEventLog, type LogEntry } from './event-log.util';

const update = (over: Partial<CompetitorUpdate> = {}): CompetitorUpdate => ({
  id: 'r1', distance_id: 'd1', start_number: '1', name: 'A', heat: 1, lane: 'red', laps_count: 0, total_time: '', formatted_total_time: '',
  lap_times: [], laps_remaining: null, finished_rank: null, is_final_lap: false, position: 0, position_change: null,
  personal_record: null, category: null, invalid_reason: null, remark: null, ...over,
});

describe('diffUpdate', () => {
  it('finds nothing when nothing differs', () => {
    expect(diffUpdate(update(), update())).toEqual([]);
  });

  it('names a new lap with its number and a changed time, rank, status and remark', () => {
    const prev = update({ lap_times: ['30.1'] });
    const next = update({ lap_times: ['30.1', '31.2'], formatted_total_time: '1:01.3', finished_rank: 2, invalid_reason: 'DNF', remark: 'PB' });
    expect(diffUpdate(prev, next)).toEqual([
      { field: 'lap', n: 2, from: '', to: '31.2' },
      { field: 'time', from: '', to: '1:01.3' },
      { field: 'rank', from: '', to: '2' },
      { field: 'status', from: '', to: 'DNF' },
      { field: 'remark', from: '', to: 'PB' },
    ]);
  });

  it('counts every value as set for a racer seen for the first time', () => {
    expect(diffUpdate(undefined, update({ lap_times: ['30.1'] })).map((c) => c.field)).toEqual(['heat', 'lane', 'lap']);
  });
});

describe('the stored log', () => {
  const entry = (id: number, at: number): LogEntry => ({ id, batch: id, at, distanceId: 'd', distanceName: '500', raceId: 'r', heat: 1, name: 'A', isNew: false, changes: [] });
  const store = (): Storage => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
  };

  it('comes back as it was saved, and only for its own competition', () => {
    const storage = store();
    const now = new Date(2026, 9, 18, 15, 0).getTime();
    saveEventLog('c1', [entry(2, now), entry(1, now - 1000)], storage);
    expect(loadEventLog('c1', now, storage).map((e) => e.id)).toEqual([2, 1]);
    expect(loadEventLog('c2', now, storage)).toEqual([]);
  });

  it('drops what an earlier day left', () => {
    const storage = store();
    const yesterday = new Date(2026, 9, 17, 23, 59).getTime();
    const today = new Date(2026, 9, 18, 0, 1).getTime();
    saveEventLog('c1', [entry(2, today), entry(1, yesterday)], storage);
    expect(loadEventLog('c1', today + 1000, storage).map((e) => e.id)).toEqual([2]);
  });

  it('is empty for stored text that is not a log', () => {
    const storage = { getItem: () => '{oops' } as unknown as Storage;
    expect(loadEventLog('c1', Date.now(), storage)).toEqual([]);
  });
});

describe('isPastHeat', () => {
  const racer = (heat: number, laps: number) => ({ heat, lap_times: Array(laps).fill('30.0') });
  it('is true for a heat before the latest one with lap times', () => {
    expect(isPastHeat([racer(1, 2), racer(2, 1)], 1)).toBe(true);
  });
  it('is false for the latest heat, a later one, and when nothing was timed', () => {
    expect(isPastHeat([racer(1, 2), racer(2, 1)], 2)).toBe(false);
    expect(isPastHeat([racer(1, 2), racer(2, 1)], 3)).toBe(false);
    expect(isPastHeat([racer(1, 0), racer(2, 0)], 1)).toBe(false);
  });
});
