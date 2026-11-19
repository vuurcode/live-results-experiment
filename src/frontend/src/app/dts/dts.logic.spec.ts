import { describe, expect, it } from 'vitest';
import { applyOp, byCap, byCapOpenFirst, clockOffset, findRacers, minutesLate, minutesToCutoff, normalizeCap, normalizeTransponder, splitName, syncDelay, transponderKeyboard, editTransponder, typeTransponder, validCap, validTransponder, warnings } from './dts.logic';
import type { DtsEntry, DtsRace, DtsState } from './dts.models';

const entry = (id: string, name: string, cap: string, extra: Partial<DtsEntry> = {}): DtsEntry => ({ id, name, cap, signed: false, ...extra });
const race = (id: string, entries: DtsEntry[]): DtsRace => ({
  id, code: `NO-${id}`, name: '', title: `NO-${id}`, start: '2026-11-08T17:30:00', cutoffMinutes: 30, cutoffAt: '2026-11-08T16:00:00Z',
  signed: 0, unsigned: entries.length, late: 0, entries,
});
const state = (races: DtsRace[]): DtsState => ({ id: 's', now: '', races, warnings: [], notes: [], latestActions: [], totals: {}, devices: [] });

describe('validation', () => {
  it('accepts cap numbers of an optional letter and 1 to 3 digits', () => {
    for (const v of ['7', 'X3', 'W81', '123']) expect(validCap(v), v).toBe(true);
    for (const v of ['', 'x3', '1234', 'XX1', 'W']) expect(validCap(v), v).toBe(false);
  });
  it('accepts transponders of two letters, a hyphen and five digits', () => {
    expect(validTransponder('AB-12345')).toBe(true);
    for (const v of ['AB12345', 'A-12345', 'AB-1234']) expect(validTransponder(v), v).toBe(false);
  });
  it('normalises what was typed', () => {
    expect(normalizeCap(' w 81 ')).toBe('W81');
    expect(normalizeTransponder('ab12345')).toBe('AB-12345');
    expect(normalizeTransponder('ab-12345')).toBe('AB-12345');
  });
});

describe('warnings', () => {
  it('is severe for a cap or transponder twice in one race, in either slot', () => {
    const w = warnings([race('1', [entry('a', 'A', '5', { t1: 'AB-11111' }), entry('b', 'B', '5', { t2: 'AB-11111' })])]);
    expect(w.map((x) => `${x.level} ${x.kind}`).sort()).toEqual(['severe cap', 'severe transponder']);
  });
  it('is light for a transponder across races and never for a cap across races', () => {
    const w = warnings([race('1', [entry('a', 'A', '5', { t1: 'AB-11111' })]), race('2', [entry('b', 'B', '5', { t1: 'AB-11111' })])]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: 'light', kind: 'transponder' });
  });
  it('does not warn about a transponder shared by one rider (same licence) in two races', () => {
    const w = warnings([race('1', [entry('a', 'A', '5', { licence: '1001', t1: 'AB-11111' })]), race('2', [entry('b', 'A', '5', { licence: '1001', t1: 'AB-11111' })])]);
    expect(w).toEqual([]);
  });
  it('lists severe first', () => {
    const w = warnings([race('1', [entry('a', 'A', '5', { t1: 'AB-11111' }), entry('b', 'B', '5')]), race('2', [entry('c', 'C', '1', { t1: 'AB-11111' })])]);
    expect(w[0].level).toBe('severe');
  });
});

describe('applyOp', () => {
  const base = state([race('1', [entry('a', 'Jansen, Piet', '5')]), race('2', [])]);
  it('signs with the late minutes against the cutoff', () => {
    const s = applyOp(base, { id: 'o', at: '2026-11-08T16:10:30Z', kind: 'sign', entry: 'a', value: '1', device: 'd' });
    expect(s.races[0].entries[0]).toMatchObject({ signed: true, minutesLate: 11, signedBy: 'd' });
    expect(s.races[0]).toMatchObject({ signed: 1, unsigned: 0, late: 1 });
    expect(base.races[0].entries[0].signed).toBe(false);
  });
  it('changes one field at a time', () => {
    let s = applyOp(base, { id: 'o1', at: 'x', kind: 'cap', entry: 'a', value: 'X3' });
    s = applyOp(s, { id: 'o2', at: 'x', kind: 'transponder1', entry: 'a', value: 'AB-12345' });
    s = applyOp(s, { id: 'o3', at: 'x', kind: 'transponder2', entry: 'a', value: 'CD-12345' });
    s = applyOp(s, { id: 'o4', at: 'x', kind: 'transponder2', entry: 'a', value: '' });
    expect(s.races[0].entries[0]).toMatchObject({ cap: 'X3', t1: 'AB-12345', t2: undefined });
  });
  it('moves a racer to another race and adds one', () => {
    let s = applyOp(base, { id: 'o1', at: 'x', kind: 'race', entry: 'a', value: '2' });
    expect(s.races.map((r) => r.entries.length)).toEqual([0, 1]);
    s = applyOp(s, { id: 'n', at: 'x', kind: 'add-racer', who: 'Nieuw', race: '1', cap: 'X1', signed: true, device: 'd' });
    expect(s.races[0].entries[0]).toMatchObject({ id: 'n', name: 'Nieuw', added: true, signed: true });
  });
  it('shows the collision caused by an operation', () => {
    const two = state([race('1', [entry('a', 'A', '5'), entry('b', 'B', '6')])]);
    expect(applyOp(two, { id: 'o', at: 'x', kind: 'cap', entry: 'b', value: '5' }).warnings).toHaveLength(1);
  });
});

describe('finding racers', () => {
  const races = [race('1', [entry('a', 'Jansen, Piet', '5', { licence: '100' }), entry('b', 'Vermeer, Anna', '12'), entry('c', 'Jansen, Kees', '13')])];
  it('matches a cap number exactly', () => expect(findRacers(races, '12').map((e) => e.id)).toEqual(['b']));
  it('matches name parts, at most three', () => {
    expect(findRacers(races, 'jans').map((e) => e.id)).toEqual(['a', 'c']);
    expect(findRacers(races, 'jans kees').map((e) => e.id)).toEqual(['c']);
    expect(findRacers(races, 'e', 1)).toHaveLength(1);
  });
  it('finds nothing for nothing', () => expect(findRacers(races, ' ')).toEqual([]));
});

describe('time', () => {
  it('rounds the minutes late up and the minutes to the cutoff down', () => {
    expect(minutesLate('2026-11-08T16:00:01Z', '2026-11-08T16:00:00Z')).toBe(1);
    expect(minutesLate('2026-11-08T15:59:59Z', '2026-11-08T16:00:00Z')).toBe(0);
    const r = race('1', []);
    expect(minutesToCutoff(Date.parse('2026-11-08T15:40:30Z'), r)).toBe(19);
    expect(minutesToCutoff(Date.parse('2026-11-08T16:05:00Z'), r)).toBe(-5);
  });
  it('takes the offset at the middle of the round trip', () => expect(clockOffset('2026-11-08T16:00:10.000Z', Date.parse('2026-11-08T16:00:00Z'), Date.parse('2026-11-08T16:00:02Z'))).toBe(9000));
  it('waits 4 s, then longer after failures up to 30 s, and 30 s when hidden', () => {
    expect([0, 1, 2, 3, 9].map((n) => syncDelay(n, true))).toEqual([4000, 2000, 4000, 8000, 30000]);
    expect(syncDelay(0, false)).toBe(30000);
  });
  it('splits a surname first name', () => {
    expect(splitName('Jansen, Piet')).toEqual({ last: 'Jansen', first: 'Piet' });
    expect(splitName('Piet')).toEqual({ last: 'Piet', first: '' });
  });
});

describe('byCap', () => {
  it('puts 2 before 10 before 100', () => {
    expect(byCap([{ cap: '100' }, { cap: '2' }, { cap: '10' }]).map((e) => e.cap)).toEqual(['2', '10', '100']);
  });
});

describe('byCapOpenFirst', () => {
  it('lists the open numbers first and the signed ones last, each in natural order', () => {
    const list = [{ cap: '10', signed: true }, { cap: '3', signed: false }, { cap: '2', signed: true }, { cap: '20', signed: false }];
    expect(byCapOpenFirst(list).map((e) => e.cap)).toEqual(['3', '20', '2', '10']);
  });

  it('asks for the digit keypad once the caret is behind the hyphen of a transponder', () => {
    expect([0, 1, 2, 3, 8].map((c) => transponderKeyboard(c, 'AB-12345'))).toEqual(['text', 'text', 'text', 'numeric', 'numeric']);
    expect(transponderKeyboard(2, 'AB')).toBe('numeric');
  });

  it('adds the hyphen of a transponder as the second letter is typed, and lets it be deleted', () => {
    expect(typeTransponder('A', '')).toBe('A');
    expect(typeTransponder('ab', 'a')).toBe('AB-');
    expect(typeTransponder('AB-1', 'AB-')).toBe('AB-1');
    expect(typeTransponder('AB', 'AB-')).toBe('AB');
    expect(typeTransponder('AB12345', '')).toBe('AB-12345');
  });

  it('keeps the caret where a transponder is edited and lets the hyphen be deleted through', () => {
    // a digit typed in the middle stays in the middle
    expect(editTransponder('AB-123845', 6, 'AB-12345')).toEqual({ value: 'AB-12384', caret: 6 });
    // the second letter puts the caret behind the hyphen
    expect(editTransponder('AB', 2, 'A')).toEqual({ value: 'AB-', caret: 3 });
    // backspace right behind the hyphen deletes the letter before it
    expect(editTransponder('AB1', 2, 'AB-1')).toEqual({ value: 'A-1', caret: 1 });
    // a letter replaced at the start keeps the caret there
    expect(editTransponder('CAB-12345', 1, 'AB-12345')).toEqual({ value: 'CA-12345', caret: 1 });
  });

  it('keeps the digits of a transponder in place when a letter is deleted', () => {
    expect(editTransponder('A-12345', 1, 'AB-12345')).toEqual({ value: 'A-12345', caret: 1 });
    expect(typeTransponder('A1', 'A')).toBe('A-1');
    expect(typeTransponder('AB-12X45', '')).toBe('AB-1245');
  });
});
