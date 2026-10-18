import { describe, expect, it } from 'vitest';
import { ordinalSuffix } from './ordinal.util';

describe('ordinalSuffix', () => {
  it('gives st, nd, rd and th, with th for the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((n) => ordinalSuffix(n)[1])).toEqual(['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'rd', 'st', 'th']);
  });
});
