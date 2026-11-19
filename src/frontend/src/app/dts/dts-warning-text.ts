import type { DtsKey } from './dts.strings';
import type { DtsRace, DtsWarning } from './dts.models';

/** The sentence for a warning, from the point of view of one racer (or the whole race when entryId is empty). */
export function warningSentence(
  w: DtsWarning,
  entryId: string,
  races: DtsRace[],
  t: (key: DtsKey, params?: Record<string, string | number>) => string,
): string {
  const all = races.flatMap((r) => r.entries.map((e) => ({ e, r })));
  const others = all.filter((x) => w.entries.includes(x.e.id) && x.e.id !== entryId);
  const subject = others.length ? others : all.filter((x) => w.entries.includes(x.e.id));
  const names = subject.map((x) => x.e.name.split(',')[0]).join(', ');
  const raceCode = (subject[0]?.r ?? races.find((r) => r.id === w.race))?.title ?? '';
  if (w.kind === 'cap') return t('warnCap', { value: w.value, names, race: raceCode });
  return w.level === 'severe' ? t('warnTransponderSame', { value: w.value, names, race: raceCode }) : t('warnTransponderOther', { value: w.value, names });
}
