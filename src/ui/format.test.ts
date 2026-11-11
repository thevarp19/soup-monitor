import { describe, expect, it } from 'vitest';
import { formatCount, formatPrecise, formatStep, formatValue } from './format.ts';

const EN = 'en-US';

describe('formatValue (cards, readouts)', () => {
  it.each([
    [2.3147, '2.315'],
    [62.0915, '62.09'],
    [10.8, '10.8'],
    [1234.5, '1,235'],
    [0.0123456, '0.01235'],
    [2.96e-4, '2.96E-4'],
    [3e-5, '3E-5'],
    [2.5e7, '2.5E7'],
    [-0.15, '-0.15'],
    [0, '0'],
  ])('%d → %s', (v, want) => {
    expect(formatValue(v, EN)).toBe(want);
  });

  it('names non-finite values instead of hiding them', () => {
    expect(formatValue(NaN, EN)).toBe('NaN');
    expect(formatValue(Infinity, EN)).toBe('+∞');
    expect(formatValue(-Infinity, EN)).toBe('−∞');
  });

  it('shows a dash for "no value", never 0', () => {
    expect(formatValue(null, EN)).toBe('—');
    expect(formatValue(undefined, EN)).toBe('—');
  });

  it('never rounds a small learning rate to 0', () => {
    expect(formatValue(1e-7, EN)).not.toMatch(/^0$|^0\.0+$/);
  });
});

describe('formatPrecise (tooltip: enough digits to identify the raw value)', () => {
  it('keeps 10 significant digits', () => {
    expect(formatPrecise(62.09153412345, EN)).toBe('62.09153412');
    expect(formatPrecise(2.961234567e-4, EN)).toBe('2.961234567E-4');
  });
  it('names non-finite values', () => {
    expect(formatPrecise(NaN, EN)).toBe('NaN');
  });
});

describe('formatStep / formatCount', () => {
  it('integers with grouping', () => {
    expect(formatStep(500_000, EN)).toBe('500,000');
    expect(formatCount(1_000_000, EN)).toBe('1,000,000');
    expect(formatStep(null, EN)).toBe('—');
  });
});

// Same numbers, three locales. The locale is always passed explicitly, so these hold whatever the
// machine's own locale/time zone is (scripts/test-intl.mjs re-runs the suite under 6 combinations).
// Note how "1.235" means 1,235 in de-DE: the footer always names the locale in use.
describe.each([
  ['en-US', { big: '1,235', mid: '2.315', lr: '2.96E-4', neg: '-0.15', step: '500,000' }],
  ['de-DE', { big: '1.235', mid: '2,315', lr: '2,96E-4', neg: '-0,15', step: '500.000' }],
  ['ru-RU', { big: '1\u00a0235', mid: '2,315', lr: '2,96E-4', neg: '-0,15', step: '500\u00a0000' }],
])('formatting in %s', (locale, want) => {
  it('values and steps', () => {
    expect([formatValue(1234.5, locale), formatValue(2.3147, locale), formatValue(2.96e-4, locale), formatValue(-0.15, locale), formatStep(500_000, locale)]).toEqual([
      want.big,
      want.mid,
      want.lr,
      want.neg,
      want.step,
    ]);
  });
  it('non-finite values are named the same way in every locale', () => {
    expect([formatValue(NaN, locale), formatValue(Infinity, locale), formatValue(null, locale)]).toEqual(['NaN', '+∞', '—']);
  });
});

