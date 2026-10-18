/** Returns [base, suffix] for an ordinal, e.g. ordinalSuffix(1) → ['1','st'] */
export function ordinalSuffix(n: number): [string, string] {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return [String(n), s[(v - 20) % 10] ?? s[v] ?? s[0]];
}
