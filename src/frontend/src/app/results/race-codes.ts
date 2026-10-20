/** The codes the data source puts in a race's `remark` and `invalid_reason`. */
export const RaceCode = {
  PersonalRecord: 'PR',
  WorldRecord: 'WR',
  NationalRecord: 'NR',
  TrackRecord: 'TR',
  TrackRecordCourse: 'TRC',
  Fall: 'FL',
  Disqualified: 'DQ',
  DidNotStart: 'DNS',
  DidNotFinish: 'DNF',
  Withdrawn: 'WDR',
  ManualTime: 'MT',
} as const;

export type RaceCodeValue = (typeof RaceCode)[keyof typeof RaceCode];

/** Codes of a race that has no result time. A fall is only a note explaining a slow time, so it is not one of them. */
export const NO_TIME_CODES: ReadonlySet<string> = new Set<string>([
  RaceCode.Disqualified, RaceCode.DidNotStart, RaceCode.DidNotFinish, RaceCode.Withdrawn,
]);

/** Codes of a race that never really ran: the card shows no placeholder badges for the laps to come. */
export const GHOST_HIDING_CODES: ReadonlySet<string> = new Set<string>([RaceCode.DidNotStart, RaceCode.Disqualified, RaceCode.Withdrawn]);

/** The record codes, the most significant first: a race with several of them shows the first in its watermark. TRC is a track record on the course. */
export const RECORD_PRIORITY: readonly string[] = [RaceCode.WorldRecord, RaceCode.NationalRecord, RaceCode.TrackRecord, RaceCode.TrackRecordCourse];
export const RECORD_CODES: ReadonlySet<string> = new Set<string>(RECORD_PRIORITY);

/** The records and the personal record, the most significant first: of these, a racer's badges show only the first they have. */
export const ACHIEVEMENT_PRIORITY: readonly string[] = [...RECORD_PRIORITY, RaceCode.PersonalRecord];

/** The codes with only the most significant of the records and the personal record kept; the order of the others stays. */
export function topAchievementOnly(codes: readonly string[]): string[] {
  const best = ACHIEVEMENT_PRIORITY.find((code) => codes.some((c) => c.toUpperCase() === code));
  return codes.filter((code) => !ACHIEVEMENT_PRIORITY.includes(code.toUpperCase()) || code.toUpperCase() === best);
}

/** Codes of a competitor who is not on the ice: the card never gets the live tag and does not make its heat the live one. */
const NEVER_LIVE_CODES: ReadonlySet<string> = new Set<string>([RaceCode.DidNotStart, RaceCode.Withdrawn]);

export function isNeverLive(race: { invalid_reason?: string | null; remark?: string | null }): boolean {
  const codes = [race.invalid_reason, ...(race.remark?.trim().split(/\s+/) ?? [])];
  return codes.some(c => !!c && NEVER_LIVE_CODES.has(c.toUpperCase()));
}

/** CSS class for the badge of a remark (PR and the records → purple, the records also pulse, else orange). */
export function remarkBadgeClass(remark: string): string {
  const v = remark.toUpperCase();
  if (RECORD_CODES.has(v)) return 'individual-badge-purple individual-badge-record';
  return v === RaceCode.PersonalRecord ? 'individual-badge-purple' : 'individual-badge-orange';
}

/** CSS class for the badge of an invalid reason (DQ → red, else orange). */
export function invalidBadgeClass(reason: string): string {
  return reason.toUpperCase() === RaceCode.Disqualified ? 'individual-badge-red' : 'individual-badge-orange';
}
