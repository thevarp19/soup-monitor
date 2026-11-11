/**
 * Reading a number the user typed. The silent failure: parseFloat("1,5") is 1 and parseFloat on
 * "500 000" is 500 — no error, just a wrong number. Rules:
 *  - spaces (incl. no-break / narrow no-break) are only ever digit grouping; "−" (U+2212) is minus;
 *  - "1,5" and "1.5" are one and a half in every locale;
 *  - with both "," and ".", the last one is the decimal separator ("1,234.5", "1.234,5");
 *  - a separator that appears several times is grouping, in groups of exactly 3 digits;
 *  - a single separator followed by exactly 3 digits is grouping ONLY if it is the locale's grouping
 *    separator: "1,500" is 1500 in en-US and 1.5 in de-DE;
 *  - anything else (letters, "NaN", "Infinity", "1,2,3") is rejected, never guessed.
 */
export type ParseResult = { ok: true; value: number } | { ok: false; error: 'empty' | 'invalid' };

const groupSeparators = new Map<string, string>();
function groupSeparatorOf(locale: string): string {
  let g = groupSeparators.get(locale);
  if (g === undefined) {
    g = new Intl.NumberFormat(locale).formatToParts(1000000).find((p) => p.type === 'group')?.value ?? ',';
    groupSeparators.set(locale, g);
  }
  return g;
}

const grouped = (s: string, sep: string) => {
  const parts = s.split(sep);
  return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
};
const invalid: ParseResult = { ok: false, error: 'invalid' };

export function parseUserNumber(text: string, locale: string): ParseResult {
  let s = text.replace(/[\s\u00a0\u202f\u2009]/g, '').replace(/\u2212/g, '-');
  if (!s) return { ok: false, error: 'empty' };
  const m = /^([+-]?)([0-9.,]+)([eE][+-]?\d+)?$/.exec(s);
  if (!m || !/\d/.test(m[2])) return invalid;
  const [, sign, body, exp = ''] = m;
  s = body;

  const commas = s.split(',').length - 1;
  const dots = s.split('.').length - 1;
  let digits: string;
  if (commas && dots) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const grp = dec === ',' ? '.' : ',';
    const parts = s.split(dec);
    if (parts.length !== 2 || parts[1] === '' || parts[1].includes(grp) || !grouped(parts[0], grp)) return invalid;
    digits = `${parts[0].split(grp).join('')}.${parts[1]}`;
  } else if (commas + dots === 0) {
    digits = s;
  } else {
    const sep = commas ? ',' : '.';
    if (commas + dots > 1) {
      if (!grouped(s, sep)) return invalid;
      digits = s.split(sep).join('');
    } else {
      const [a, b] = s.split(sep);
      if (a === '' || b === '') return invalid;
      const isGrouping = sep === groupSeparatorOf(locale) && /^\d{3}$/.test(b) && /^\d{1,3}$/.test(a);
      digits = isGrouping ? a + b : `${a}.${b}`;
    }
  }
  const value = Number(sign + digits + exp);
  return Number.isFinite(value) ? { ok: true, value } : invalid;
}
