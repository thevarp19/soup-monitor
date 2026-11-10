/**
 * Number formatting for the UI. The locale is ALWAYS passed explicitly (never the runtime default),
 * so the same data renders the same way regardless of the machine's settings — and a test can pin it.
 * Non-finite values are named ("NaN", "+∞", "−∞"); "no value" is a dash, never 0.
 */
const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

function special(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return '—';
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return '+∞';
  if (v === -Infinity) return '−∞';
  return null;
}

const scientific = (v: number) => v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6);

/** Cards and readouts: 4 significant digits; scientific below 1e-3 (learning rates) or from 1e6. */
export function formatValue(v: number | null | undefined, locale: string): string {
  const s = special(v);
  if (s !== null) return s;
  const x = v as number;
  if (scientific(x)) return nf(locale, { notation: 'scientific', maximumSignificantDigits: 3 }).format(x);
  return nf(locale, { maximumSignificantDigits: 4 }).format(x);
}

/** Tooltip: 10 significant digits — enough to recognise the exact raw value. */
export function formatPrecise(v: number | null | undefined, locale: string): string {
  const s = special(v);
  if (s !== null) return s;
  const x = v as number;
  if (scientific(x)) return nf(locale, { notation: 'scientific', maximumSignificantDigits: 10 }).format(x);
  return nf(locale, { maximumSignificantDigits: 10 }).format(x);
}

export function formatStep(v: number | null | undefined, locale: string): string {
  const s = special(v);
  return s ?? nf(locale, { maximumFractionDigits: 0 }).format(v as number);
}

export const formatCount = formatStep;
