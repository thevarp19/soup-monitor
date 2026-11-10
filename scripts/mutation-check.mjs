// Mutation check: proves the truthfulness tests can actually fail.
//
// Each mutation injects one realistic bug into the source, runs the relevant test files, and
// restores the original file (always — also on error or Ctrl-C). A mutation is CAUGHT when the
// tests fail, and SURVIVED when they still pass. Exit code 1 if anything survived.
//
// usage: node scripts/mutation-check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MUTATIONS = [
  // normalize.ts
  { file: 'src/core/normalize.ts', name: 'duplicates: first write wins instead of last', find: 'keep[rows++] = perm[j]; // last write in log order', replace: 'keep[rows++] = perm[k];', tests: ['src/core/normalize.test.ts'] },
  { file: 'src/core/normalize.ts', name: 'gaps: >= instead of > at the threshold', find: 'if (deltas[k] > threshold)', replace: 'if (deltas[k] >= threshold)', tests: ['src/core/normalize.test.ts'] },
  { file: 'src/core/normalize.ts', name: 'NaN values gathered as 0', find: 'for (let k = 0; k < rows; k++) out[k] = src[keep[k]];', replace: 'for (let k = 0; k < rows; k++) out[k] = src[keep[k]] || 0;', tests: ['src/core/normalize.test.ts'] },
  { file: 'src/core/normalize.ts', name: 'gap median computed on raw spacing incl. duplicates', find: 'for (let k = 1; k < rows; k++) deltas[k - 1] = step[k] - step[k - 1];', replace: 'for (let k = 1; k < rows; k++) deltas[k - 1] = (step[k] - step[k - 1]) * (k % 2);', tests: ['src/core/normalize.test.ts'] },
  // downsample.ts
  { file: 'src/core/downsample.ts', name: 'M4 → min/max only (first/last dropped)', find: 'const idx = [pFirst, pMin, pMax, pLast]', replace: 'const idx = [pMin, pMax]', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'every 2nd point only (naive decimation)', find: 'for (let i = start; i <= end; i++) {', replace: 'for (let i = start; i <= end; i += 2) {', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'NaN drawn as 0', find: '    const v = y[i];\n    const inside', replace: '    const v = Number.isNaN(y[i]) ? 0 : y[i];\n    const inside', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'NaN skipped without breaking the line', find: '      markBreak(x[i]);\n      continue;', replace: '      continue;', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'gaps do not break the line', find: 'gapStarts[gi] === i) markBreak', replace: 'gapStarts[gi] === -1) markBreak', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'pixel column with round() instead of floor()', find: 'Math.floor(((x - x0) / span) * width)', replace: 'Math.round(((x - x0) / span) * width)', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'log scale: values ≤ 0 not treated as undrawable', find: "if (log && v <= 0) return 'nonpositive';", replace: '', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'no off-screen edge neighbours', find: 'const start = lo > 0 ? lo - 1 : 0;', replace: 'const start = lo;', tests: ['src/core/downsample.test.ts'] },
  { file: 'src/core/downsample.ts', name: 'tooltip min: latest step on ties', find: 'if (!(buckets.min[col] <= v)) {', replace: 'if (!(buckets.min[col] < v)) {', tests: ['src/core/downsample.test.ts'] },
  // ema.ts
  { file: 'src/core/ema.ts', name: 'EMA fills NaN with the previous smoothed value', find: '      out[i] = NaN;\n      continue;', replace: '      out[i] = i > 0 ? out[i - 1] : NaN;\n      continue;', tests: ['src/core/ema.test.ts'] },
  { file: 'src/core/ema.ts', name: 'EMA treats NaN as 0', find: '    if (!Number.isFinite(v)) {', replace: '    if (Number.isNaN(v)) { k++; acc = weight * acc; out[i] = NaN; continue; }\n    if (!Number.isFinite(v)) {', tests: ['src/core/ema.test.ts'] },
  { file: 'src/core/ema.ts', name: 'EMA without debias', find: 'out[i] = acc / (1 - wk);', replace: 'out[i] = acc;', tests: ['src/core/ema.test.ts'] },
  // summary.ts
  { file: 'src/core/summary.ts', name: '"last loss" shows the last finite value', find: 'lastLoss: n > 0 ? { step: run.step[n - 1], value: run.loss[n - 1] } : null,', replace: 'lastLoss: lastFiniteLoss,', tests: ['src/core/summary.test.ts'] },
  { file: 'src/core/summary.ts', name: 'max grad_norm includes +Infinity', find: '    if (Number.isFinite(g)) {', replace: '    if (!Number.isNaN(g)) {', tests: ['src/core/summary.test.ts'] },
  { file: 'src/core/summary.ts', name: 'empty run: min loss 0 instead of null', find: 'minLoss,\n    currentLr,', replace: 'minLoss: minLoss ?? { step: 0, value: 0 },\n    currentLr,', tests: ['src/core/summary.test.ts'] },
  // scale.ts
  // (A first version only swapped floor/ceil for round; it survived because the coverage guard below
  // compensates — an equivalent mutant. This one removes the guard too.)
  { file: 'src/core/scale.ts', name: 'axis range does not cover the data (round, no guard)', find: 'const first = Math.floor(lo / step);\n    const last = Math.ceil(hi / step);\n    if (last - first + 1 > n) continue;\n    const ticks: number[] = [];\n    for (let k = first; k <= last; k++) ticks.push(clean(k * step));\n    if (ticks[0] > lo) ticks.unshift(clean((first - 1) * step));\n    if (ticks[ticks.length - 1] < hi) ticks.push(clean((last + 1) * step));', replace: 'const first = Math.round(lo / step);\n    const last = Math.round(hi / step);\n    if (last - first + 1 > n) continue;\n    const ticks: number[] = [];\n    for (let k = first; k <= last; k++) ticks.push(clean(k * step));', tests: ['src/core/scale.test.ts'] },
  { file: 'src/core/scale.ts', name: 'tick labels with one decimal too few', find: 'const decimals = decimalsOf(step);', replace: 'const decimals = decimalsOf(step) - 1;', tests: ['src/core/scale.test.ts'] },
  { file: 'src/core/scale.ts', name: 'visibleExtent ignores the max of the last column', find: 'for (let p = 0; p < mins.length; p++) {', replace: 'for (let p = 0; p < mins.length - 1; p++) {', tests: ['src/core/scale.test.ts'] },
  // UI logic (stage 4)
  { file: 'src/ui/listModel.ts', name: 'list sort: NaN treated like a number (comparator returns NaN)', find: 'const rank = (v: number | null) => (v === null ? 2 : Number.isNaN(v) ? 1 : 0);', replace: 'const rank = (v: number | null) => (v === null ? 2 : 0);', tests: ['src/ui/listModel.test.ts'] },
  { file: 'src/hooks/useRequest.ts', name: 'race: a late response may overwrite the current run', find: '      if (latest.current !== id || ctrl.signal.aborted) return;', replace: '', tests: ['src/hooks/useRequest.test.tsx'] },
  { file: 'src/hooks/useRequest.ts', name: 'a new key shows the previous key\'s data while loading', find: 'const shown = lastGood && (keepPrevious || lastGood.key === key) ? lastGood : null;', replace: 'const shown = lastGood;', tests: ['src/hooks/useRequest.test.tsx'] },
  { file: 'src/ui/tooltip.ts', name: 'readout reads only one column under the cursor', find: 'const p0 = columnOf(clamp(Math.min(a, b)), x0, x1, width);', replace: 'const p0 = columnOf(clamp(Math.max(a, b)), x0, x1, width);', tests: ['src/ui/tooltip.test.ts'] },
  { file: 'src/ui/format.ts', name: 'NaN formatted as 0', find: "if (Number.isNaN(v)) return 'NaN';", replace: "if (Number.isNaN(v)) return '0';", tests: ['src/ui/format.test.ts'] },
  { file: 'src/ui/format.ts', name: 'small lr rounded to fixed decimals', find: "if (scientific(x)) return nf(locale, { notation: 'scientific', maximumSignificantDigits: 3 }).format(x);", replace: "if (scientific(x)) return nf(locale, { maximumFractionDigits: 3 }).format(x);", tests: ['src/ui/format.test.ts'] },
];

const TIMEOUT_MS = 120_000;
let current = null; // { file, original } while a mutation is applied

function restore() {
  if (current) {
    writeFileSync(current.file, current.original);
    current = null;
  }
}
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

const rows = [];
try {
  for (const m of MUTATIONS) {
    const original = readFileSync(m.file, 'utf8');
    const occurrences = original.split(m.find).length - 1;
    if (occurrences !== 1) {
      rows.push({ ...m, result: `INVALID (pattern found ${occurrences}×)` });
      continue;
    }
    current = { file: m.file, original };
    writeFileSync(m.file, original.replace(m.find, m.replace));
    const res = spawnSync('pnpm', ['exec', 'vitest', 'run', ...m.tests], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      env: { ...process.env, NO_COLOR: '1' },
    });
    restore();
    const out = `${res.stdout}\n${res.stderr}`;
    const failed = /Tests\s+(\d+) failed/.exec(out)?.[1];
    let result;
    if (res.error?.code === 'ETIMEDOUT' || res.signal) result = `CAUGHT (test run hung, killed after ${TIMEOUT_MS / 1000}s)`;
    else if (res.status !== 0) result = `CAUGHT (${failed ?? '?'} failing tests)`;
    else result = 'SURVIVED';
    rows.push({ ...m, result });
    console.log(`${result.padEnd(32)} ${m.file.replace('src/core/', '')}: ${m.name}`);
  }
} finally {
  restore();
}

const survived = rows.filter((r) => !r.result.startsWith('CAUGHT'));
console.log(`\n${rows.length - survived.length}/${rows.length} mutations caught.`);
if (survived.length) {
  console.log('Not caught:');
  for (const r of survived) console.log(`  - ${r.file}: ${r.name} → ${r.result}`);
}
process.exit(survived.length ? 1 : 0);
