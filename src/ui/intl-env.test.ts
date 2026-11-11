/**
 * Canary for scripts/test-intl.mjs: proves that the locale/time zone given through the environment
 * actually reached Intl. Without it, a matrix run where LANG/TZ were silently ignored would "pass"
 * while testing nothing. Skipped in normal runs (no INTL_EXPECT_* variables).
 */
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> }; // Node global; the app tsconfig has no Node types

const wantLocale = process.env.INTL_EXPECT_LOCALE;
const wantZone = process.env.INTL_EXPECT_TZ;

describe('intl environment canary', () => {
  it.skipIf(!wantLocale)('the default Intl locale is the one the matrix asked for', () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe(wantLocale);
  });
  it.skipIf(!wantZone)('the default time zone is the one the matrix asked for', () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(wantZone);
  });
});
