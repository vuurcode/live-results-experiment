import type { CompetitorUpdate } from './data.models';

/** One thing that differs between two updates of a racer. A lap carries its number `n`. */
export interface LogChange {
  field: 'heat' | 'lane' | 'lap' | 'time' | 'rank' | 'status' | 'remark';
  n?: number;
  from: string;
  to: string;
}

/** A competitor_update as it came in: the racer's heat and what the update changed, or `isNew` for a racer seen for the first time. */
export interface LogEntry {
  id: number;
  /** The updates that arrive together (one poll of the data source) share a batch number. */
  batch: number;
  at: number;
  distanceId: string;
  distanceName: string;
  raceId: string;
  heat: number;
  name: string;
  /** The lane colour of the racer; entries stored before it was kept have none. */
  lane?: string;
  /** The update is about a heat before one that has results already: a correction to something that was over. Entries stored before it was kept have none. */
  past?: boolean;
  isNew: boolean;
  changes: LogChange[];
}

/** Whether a racer's heat is before the latest heat of the distance that has lap times: `others` are the other racers of the distance as they stood. */
export function isPastHeat(others: Iterable<Pick<CompetitorUpdate, 'heat' | 'lap_times'>>, heat: number): boolean {
  let latest = 0;
  for (const other of others) if (other.lap_times.length > 0) latest = Math.max(latest, other.heat);
  return heat < latest;
}

/** The fields an update changed. Without a previous update every field that has a value counts as set. */
export function diffUpdate(prev: CompetitorUpdate | undefined, next: CompetitorUpdate): LogChange[] {
  const changes: LogChange[] = [];
  const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));
  const compare = (field: LogChange['field'], from: string | number | null | undefined, to: string | number | null | undefined) => {
    if (text(from) !== text(to)) changes.push({ field, from: text(from), to: text(to) });
  };
  compare('heat', prev?.heat, next.heat);
  compare('lane', prev?.lane, next.lane);
  const laps = Math.max(prev?.lap_times.length ?? 0, next.lap_times.length);
  for (let i = 0; i < laps; i++) {
    const from = prev?.lap_times[i] ?? '';
    const to = next.lap_times[i] ?? '';
    if (from !== to) changes.push({ field: 'lap', n: i + 1, from, to });
  }
  compare('time', prev?.formatted_total_time, next.formatted_total_time);
  compare('rank', prev?.finished_rank, next.finished_rank);
  compare('status', prev?.invalid_reason, next.invalid_reason);
  compare('remark', prev?.remark, next.remark);
  return changes;
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

/** The entries of the day of `now`, newest first; what an earlier day left is dropped. */
export function entriesOfToday(entries: LogEntry[], now: number): LogEntry[] {
  return entries.filter((entry) => sameDay(entry.at, now));
}

const storageKey = (competitionId: string): string => `eventLog:${competitionId}`;

/** The log a competition kept in this browser, of today only; empty when there is none or storage is unavailable. */
export function loadEventLog(competitionId: string | null, now: number, storage: Pick<Storage, 'getItem'> = localStorage): LogEntry[] {
  if (!competitionId) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(competitionId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((e): e is LogEntry => typeof e?.at === 'number' && typeof e?.id === 'number' && typeof e?.batch === 'number' && Array.isArray(e?.changes));
    return entriesOfToday(valid, now);
  } catch {
    return [];
  }
}

export function saveEventLog(competitionId: string | null, entries: LogEntry[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  if (!competitionId) return;
  try { storage.setItem(storageKey(competitionId), JSON.stringify(entries)); } catch { /* storage full or unavailable: the log lasts for this page */ }
}
