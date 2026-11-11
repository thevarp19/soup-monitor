import { describe, expect, it } from 'vitest';
import { parseUserNumber } from './parse.ts';

describe('the silent failure this parser exists for', () => {
  it('parseFloat("1,5") silently returns 1, Number("1,5") returns NaN', () => {
    expect(parseFloat('1,5')).toBe(1);
    expect(Number('1,5')).toBeNaN();
  });
});

describe('parseUserNumber — "1,5" and "1.5" both mean one and a half, in every locale', () => {
  it.each(['en-US', 'de-DE', 'ru-RU'])('%s', (locale) => {
    expect(parseUserNumber('1,5', locale)).toEqual({ ok: true, value: 1.5 });
    expect(parseUserNumber('1.5', locale)).toEqual({ ok: true, value: 1.5 });
    expect(parseUserNumber(' 0,95 ', locale)).toEqual({ ok: true, value: 0.95 });
    expect(parseUserNumber('\u22122,5', locale)).toEqual({ ok: true, value: -2.5 }); // U+2212 minus
  });
});

describe('parseUserNumber — grouping', () => {
  it.each([
    ['500 000', 'ru-RU', 500_000],
    ['500\u00a0000', 'ru-RU', 500_000], // no-break space, as Intl formats it
    ['500 000', 'en-US', 500_000],
    ['1,234,567', 'en-US', 1_234_567],
    ['1.234.567', 'de-DE', 1_234_567],
    ['1,234.5', 'en-US', 1234.5],
    ['1.234,5', 'de-DE', 1234.5],
  ])('%s (%s) → %d', (text, locale, value) => {
    expect(parseUserNumber(text, locale)).toEqual({ ok: true, value });
  });

  it('a single separator followed by exactly 3 digits follows the locale: "1,500" is 1500 in en-US, 1.5 in de-DE', () => {
    expect(parseUserNumber('1,500', 'en-US')).toEqual({ ok: true, value: 1500 });
    expect(parseUserNumber('1,500', 'de-DE')).toEqual({ ok: true, value: 1.5 });
    expect(parseUserNumber('500.000', 'de-DE')).toEqual({ ok: true, value: 500_000 });
    expect(parseUserNumber('500.000', 'en-US')).toEqual({ ok: true, value: 500 });
  });
});

describe('parseUserNumber — rejects instead of guessing', () => {
  it.each([[''], ['   '], ['abc'], ['1,2,3'], ['12,34,567'], ['1.2.3,4'], ['--1'], ['1e'], ['Infinity'], ['NaN']])('%j', (text) => {
    expect(parseUserNumber(text, 'en-US').ok).toBe(false);
  });
});
