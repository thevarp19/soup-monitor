// Runs the whole unit suite under 2 time zones × 3 locales (process TZ and LANG/LC_ALL), and checks
// with a canary test (src/ui/intl-env.test.ts) that each environment really reached Intl —
// otherwise a matrix where LANG/TZ were ignored would pass while testing nothing.
//
// usage: node scripts/test-intl.mjs
import { spawnSync } from 'node:child_process';

const ZONES = ['Asia/Almaty', 'America/Los_Angeles'];
const LOCALES = [
  ['ru_RU.UTF-8', 'ru-RU'],
  ['de_DE.UTF-8', 'de-DE'],
  ['en_US.UTF-8', 'en-US'],
];

let failed = 0;
for (const tz of ZONES) {
  for (const [lang, locale] of LOCALES) {
    const env = { ...process.env, TZ: tz, LANG: lang, LC_ALL: lang, INTL_EXPECT_LOCALE: locale, INTL_EXPECT_TZ: tz, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const res = spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose'], { env, encoding: 'utf8', timeout: 300_000 });
    const out = `${res.stdout}\n${res.stderr}`;
    const tests = /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ?? 'no summary';
    const canaryRan = out.split('\n').filter((l) => /✓ src\/ui\/intl-env\.test\.ts/.test(l)).length;
    const canaryText = canaryRan === 2 ? 'canary: locale and time zone took effect' : `canary ran ${canaryRan}/2 — environment NOT verified`;
    const ok = res.status === 0 && canaryRan === 2;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  TZ=${tz.padEnd(20)} LANG=${lang.padEnd(12)} → ${tests} · ${canaryText}`);
    if (!ok) console.log(out.split('\n').filter((l) => /FAIL|×|Error/.test(l)).slice(0, 20).join('\n'));
  }
}
console.log(failed ? `\n${failed} combination(s) failed.` : '\nAll 6 combinations passed.');
process.exit(failed ? 1 : 0);
