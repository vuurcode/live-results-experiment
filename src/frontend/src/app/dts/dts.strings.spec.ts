import { describe, expect, it } from 'vitest';
import { dtsText, en, initialLang, nl } from './dts.strings';

describe('dts strings', () => {
  it('has the same keys and placeholders in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort());
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(nl) as (keyof typeof nl)[]) expect(placeholders(en[key]), key).toEqual(placeholders(nl[key]));
  });
  it('fills in placeholders', () => expect(dtsText('en', 'signedOf', { signed: 3, total: 9 })).toBe('3 of 9 signed'));
  it('picks Dutch unless English was chosen, whatever the browser says', () => {
    expect(initialLang(null)).toBe('nl');
    expect(initialLang('nl')).toBe('nl');
    expect(initialLang('de')).toBe('nl');
    expect(initialLang('en')).toBe('en');
  });
});
