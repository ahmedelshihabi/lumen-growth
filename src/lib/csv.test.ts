import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('adds a BOM, quotes commas/quotes, keeps numbers, and neutralises formulas', () => {
    const out = toCsv(['name', 'spend'], [['Search | Brand, Exact', 1234.567], ['=HYPERLINK("x")', null], ['حملة "رمضان"', 5]]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.split('\r\n')).toEqual(['﻿name,spend', '"Search | Brand, Exact",1234.57', `"'=HYPERLINK(""x"")",`, '"حملة ""رمضان""",5']);
  });
});
