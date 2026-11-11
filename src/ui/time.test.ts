import { describe, expect, it } from 'vitest';
import { formatAgo, formatTime, isStale } from './time.ts';

// 2026-11-11 10:10:21 UTC. A recent date on purpose: Asia/Almaty was UTC+6 until 2024 (UTC+5 now),
// so a 1970 timestamp would test historical tzdata, not the app.
const T = Date.UTC(2026, 10, 11, 10, 10, 21);

describe('formatTime — the time zone is always named', () => {
  it.each([
    ['en-US', 'Asia/Almaty', '03:10:21 PM GMT+5'],
    ['en-US', 'America/Los_Angeles', '02:10:21 AM PST'],
    ['de-DE', 'Asia/Almaty', '15:10:21 GMT+5'],
    ['ru-RU', 'America/Los_Angeles', '02:10:21 GMT-8'],
    ['en-US', 'UTC', '10:10:21 AM UTC'],
  ])('%s in %s', (locale, zone, want) => {
    expect(formatTime(T, locale, zone)).toBe(want);
  });

  it('without an explicit zone it uses the runtime zone — and still labels it', () => {
    expect(formatTime(T, 'en-US')).toMatch(/(GMT|UTC|[A-Z]{3,4})([+-]\d+)?$/);
  });
});

describe('formatAgo — relative age, independent of the time zone', () => {
  it.each([
    [12_000, 'en-US', '12 seconds ago'],
    [125_000, 'en-US', '2 minutes ago'],
    [12_000, 'de-DE', 'vor 12 Sekunden'],
    [12_000, 'ru-RU', '12 секунд назад'],
  ])('%d ms in %s', (ms, locale, want) => {
    expect(formatAgo(ms, locale)).toBe(want);
  });
});

describe('isStale', () => {
  it('true only after the threshold has passed since the last SUCCESSFUL update', () => {
    expect(isStale(1000, 1000 + 30_000, 30_000)).toBe(false);
    expect(isStale(1000, 1000 + 30_001, 30_000)).toBe(true);
    expect(isStale(null, 99_999, 30_000)).toBe(false); // never loaded: that is "loading", not "stale"
  });
});
