import type { DtsEntry, DtsOp, DtsRace, DtsState, DtsWarning } from './dts.models';

/** The pure rules of the sign page: the same checks the service makes, so the page works with no network. */

export const CAP_PATTERN = /^[A-Z]?[0-9]{1,3}$/;
export const TRANSPONDER_PATTERN = /^[A-Z]{2}-[0-9]{5}$/;

/** A cap number as typed: upper case, no spaces. */
export function normalizeCap(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** A transponder as typed: upper case, with the hyphen added when it was left out ("ab12345"). */
export function normalizeTransponder(input: string): string {
  const t = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}[0-9]{5}$/.test(t) ? `${t.slice(0, 2)}-${t.slice(2)}` : t;
}

/** A cap number while typing: upper case, only letters and digits, no longer than a cap can be. */
export function typeCap(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** The characters of a transponder field that stay: up to two letters, then up to five digits; a letter behind a digit is dropped. */
function transponderParts(input: string): { kept: { ch: string; at: number }[]; letters: number } {
  const kept: { ch: string; at: number }[] = [];
  let letters = 0;
  let digits = 0;
  [...input.toUpperCase()].forEach((ch, at) => {
    if (/[A-Z]/.test(ch) && digits === 0 && letters < 2) {
      kept.push({ ch, at });
      letters++;
    } else if (/[0-9]/.test(ch) && digits < 5) {
      kept.push({ ch, at });
      digits++;
    }
  });
  return { kept, letters };
}

/**
 * A transponder while typing: up to two letters, the hyphen added by itself as the second letter is typed, then five digits.
 * The hyphen sits between the letters and the digits, wherever they are, so deleting a letter leaves the digits where they are.
 * `previous` is what the field held before: the hyphen is not put back when the person deletes it.
 */
export function typeTransponder(input: string, previous = ''): string {
  const { kept, letters } = transponderParts(input);
  const prefix = kept.slice(0, letters).map((k) => k.ch).join('');
  const digits = kept.slice(letters).map((k) => k.ch).join('');
  if (digits) return `${prefix}-${digits}`;
  return prefix.length === 2 && input.length > previous.length ? `${prefix}-` : prefix;
}

/**
 * Reformats a transponder field after an edit and says where the caret belongs, so typing, deleting or pasting in the middle
 * does not throw the caret to the end. Deleting the hyphen alone deletes the letter before it instead, as the hyphen
 * would come straight back.
 */
export function editTransponder(raw: string, caret: number, previous: string): { value: string; caret: number } {
  const { kept, letters } = transponderParts(raw);
  const before = kept.filter((k) => k.at < caret).length;
  if (raw.length < previous.length && typeTransponder(raw, previous) === previous && before > 0) {
    const gone = kept[before - 1].at;
    return editTransponder(raw.slice(0, gone) + raw.slice(gone + 1), gone, '');
  }
  const value = typeTransponder(raw, previous);
  // behind the second letter just typed, the caret goes behind the hyphen that came with it
  const typedSecond = letters === 2 && before === 2 && raw.length > previous.length && value.endsWith('-');
  const at = before <= letters ? before : before + 1;
  return { value, caret: Math.min(typedSecond ? at + 1 : at, value.length) };
}

/** The keyboard a transponder field asks for at the caret: letters up to the hyphen, the digit keypad behind it. */
export const transponderKeyboard = (caret: number, value = ''): 'text' | 'numeric' =>
  caret < 2 || (caret === 2 && value[2] === '-') ? 'text' : 'numeric';

export const validCap = (v: string): boolean => CAP_PATTERN.test(v);
export const validTransponder = (v: string): boolean => TRANSPONDER_PATTERN.test(v);

/** Every entry of the state, flat, each with its race. */
export function allEntries(races: DtsRace[]): (DtsEntry & { raceId: string })[] {
  return races.flatMap((r) => r.entries.map((e) => ({ ...e, raceId: r.id })));
}

/** Replays a pending operation over a state, for the screen while the operation has not reached the host. */
export function applyOp(state: DtsState, op: DtsOp): DtsState {
  const races = state.races.map((r) => ({ ...r, entries: r.entries.map((e) => ({ ...e })) }));
  const find = (id: string): [DtsRace, number] | null => {
    for (const r of races) {
      const i = r.entries.findIndex((e) => e.id === id);
      if (i >= 0) return [r, i];
    }
    return null;
  };
  if (op.kind === 'add-racer') {
    const race = races.find((r) => r.id === op.race);
    if (race && !find(op.id)) {
      race.entries.push({
        id: op.id, name: (op.who ?? '').trim(), cap: op.cap ?? '', t1: op.t1 || undefined, t2: op.t2 || undefined,
        signed: !!op.signed, signedAt: op.signed ? op.at : undefined, signedBy: op.signed ? op.device : undefined, added: true, newLicence: op.licence || undefined,
      });
    }
  } else {
    const hit = op.entry ? find(op.entry) : null;
    if (hit) {
      const [race, i] = hit;
      const e = race.entries[i];
      if (op.kind === 'sign') {
        e.signed = op.value === '1';
        e.signedAt = e.signed ? op.at : undefined;
        e.signedBy = e.signed ? op.device : undefined;
        e.minutesLate = e.signed ? minutesLate(op.at, race.cutoffAt) : undefined;
      } else if (op.kind === 'cap') e.cap = op.value ?? '';
      else if (op.kind === 'transponder1') e.t1 = op.value || undefined;
      else if (op.kind === 'transponder2') e.t2 = op.value || undefined;
      else if (op.kind === 'race') {
        const target = races.find((r) => r.id === op.value);
        if (target && target !== race) {
          race.entries.splice(i, 1);
          target.entries.push(e);
        }
      }
    }
  }
  for (const r of races) {
    r.signed = r.entries.filter((e) => e.signed).length;
    r.unsigned = r.entries.length - r.signed;
    r.late = r.entries.filter((e) => e.signed && (e.minutesLate ?? 0) > 0).length;
  }
  return { ...state, races, warnings: warnings(races) };
}

/** Whole minutes after the cutoff, rounded up; 0 when on time. */
export function minutesLate(at: string, cutoffAt: string): number {
  const ms = Date.parse(at) - Date.parse(cutoffAt);
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/** Minutes left until the cutoff (negative once it has passed), rounded down to whole minutes. */
export function minutesToCutoff(now: number, race: Pick<DtsRace, 'cutoffAt'>): number {
  return Math.floor((Date.parse(race.cutoffAt) - now) / 60000);
}

export function minutesToStart(now: number, race: Pick<DtsRace, 'cutoffAt' | 'cutoffMinutes'>): number {
  return minutesToCutoff(now, race) + race.cutoffMinutes;
}

/** A race start further than this from now suggests the wrong file or date. */
export const FAR_START_MINUTES = 36 * 60;

/** What looks wrong with a race of the uploaded file: no riders at all, or a start far from now. */
export function raceProblems(now: number, race: DtsRace): { kind: 'empty' | 'past' | 'future'; days: number }[] {
  const out: { kind: 'empty' | 'past' | 'future'; days: number }[] = [];
  if (race.signed + race.unsigned === 0) out.push({ kind: 'empty', days: 0 });
  const minutes = minutesToStart(now, race);
  if (Math.abs(minutes) > FAR_START_MINUTES) out.push({ kind: minutes < 0 ? 'past' : 'future', days: Math.round(Math.abs(minutes) / 1440) });
  return out;
}

/** The same collision rules as the service: severe within one race, light for a transponder across races when it is on more than one rider (by licence number). */
export function warnings(races: DtsRace[]): DtsWarning[] {
  const out: DtsWarning[] = [];
  const caps = new Map<string, string[]>();
  const transponders = new Map<string, { race: string; id: string; rider: string }[]>();
  for (const r of races) {
    for (const e of r.entries) {
      if (e.cap) {
        const k = `${r.id}\u0000${e.cap}`;
        caps.set(k, [...(caps.get(k) ?? []), e.id]);
      }
      for (const t of new Set([e.t1, e.t2].filter((x): x is string => !!x))) {
        transponders.set(t, [...(transponders.get(t) ?? []), { race: r.id, id: e.id, rider: e.licence ? `licence:${e.licence}` : `entry:${e.id}` }]);
      }
    }
  }
  for (const [k, ids] of caps) {
    if (ids.length > 1) out.push({ level: 'severe', kind: 'cap', value: k.split('\u0000')[1], race: k.split('\u0000')[0], entries: ids.sort() });
  }
  for (const [value, list] of transponders) {
    const perRace = new Map<string, string[]>();
    for (const { race, id } of list) perRace.set(race, [...(perRace.get(race) ?? []), id]);
    for (const [race, ids] of perRace) if (ids.length > 1) out.push({ level: 'severe', kind: 'transponder', value, race, entries: ids.sort() });
    if (perRace.size > 1 && new Set(list.map((x) => x.rider)).size > 1) out.push({ level: 'light', kind: 'transponder', value, entries: list.map((x) => x.id).sort() });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'severe' ? -1 : 1) || a.value.localeCompare(b.value));
}

/** The warnings that involve one entry, severe first. */
export function warningsFor(all: DtsWarning[], entryId: string): DtsWarning[] {
  return all.filter((w) => w.entries.includes(entryId));
}

/** Finds the racers for what was typed: a cap number matches exactly (all races), anything else matches name parts. At most `limit`. */
export function findRacers(races: DtsRace[], typed: string, limit = 3): (DtsEntry & { raceId: string })[] {
  const q = typed.trim();
  if (!q) return [];
  const flat = allEntries(races);
  const cap = normalizeCap(q);
  if (/^[A-Z]?[0-9]{1,3}$/.test(cap)) {
    const exact = flat.filter((e) => e.cap === cap);
    if (exact.length) return exact.slice(0, limit);
  }
  const parts = q.toLowerCase().split(/\s+/);
  return flat.filter((e) => parts.every((p) => e.name.toLowerCase().includes(p) || (e.licence ?? '').includes(p))).slice(0, limit);
}

/** The surname-first name of the DTS file ("Jansen, Piet") split for a large heading. */
export function splitName(name: string): { last: string; first: string } {
  const i = name.indexOf(',');
  return i < 0 ? { last: name.trim(), first: '' } : { last: name.slice(0, i).trim(), first: name.slice(i + 1).trim() };
}

/** Clock time HH:MM of an ISO instant in the browser's zone. */
export function clock(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Milliseconds to add to the device clock to get the server's time, from the server time in an answer and the device's own. */
export function clockOffset(serverTime: string, deviceBefore: number, deviceAfter: number): number {
  return Date.parse(serverTime) - Math.round((deviceBefore + deviceAfter) / 2);
}

/** The wait before the next sync: short while all goes well, growing to 30 s on failures. */
export function syncDelay(failures: number, visible: boolean): number {
  if (!visible) return 30000;
  if (failures === 0) return 4000;
  return Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
}

const capOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The entries in natural order of their number: 2 before 10 before 100. */
export function byCap<T extends { cap: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => capOrder.compare(a.cap, b.cap));
}

/** The entries in natural order of their number, the ones still to sign first and the signed ones last. */
export function byCapOpenFirst<T extends { cap: string; signed: boolean }>(entries: readonly T[]): T[] {
  const sorted = byCap(entries);
  return [...sorted.filter((e) => !e.signed), ...sorted.filter((e) => e.signed)];
}

/** The watermark of a number: its state, with the check kept in front when it is signed but shows a note or an edit. */
export function watermarkOf(state: 'note' | 'changed' | 'signed' | 'open', signed: boolean): string {
  const own = state === 'note' ? '!' : state === 'changed' ? '✎' : state === 'signed' ? '✓' : '';
  return signed && (state === 'note' || state === 'changed') ? `✓${own}` : own;
}
