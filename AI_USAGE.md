# AI usage log

Kept during the work, not reconstructed at the end. The assistant was Claude (Claude Code CLI).
The "Verified by me" field is filled in by the author only.

Times are wall-clock (UTC+5), approximate, taken from the session and file timestamps.

---

## Stage 0 — plan (17:42–17:55)

- **AI proposed:** folder structure (pure `src/core/` + thin React layer), M4 downsampling instead
  of LTTB, tooltip that shows the whole pixel bucket (min/max with their steps) when zoomed out,
  own y-range/tick functions so axis labels are unit-testable, EMA on raw data, "hide + mark" for
  log scale, manual race handling instead of TanStack Query, test oracle, 20-run catalogue.
  Flagged four measurement traps it was *not sure about* and marked them "to verify": CPU throttling
  may not apply to Web Workers; `JSHeapUsedSize` excludes worker heaps and possibly ArrayBuffer
  backing stores; Event Timing API may not report `pointermove`; uPlot may already collapse
  same-pixel points internally.
- **Accepted:** all recommendations (Vercel, "tab memory" interpretation, live run + polling,
  naive pipeline behind `?impl=naive`, hide + mark for log scale).
- **Changed:** —
- **Where AI was wrong:** — (the four uncertain claims are still unverified; see stage 3)
- **Verified by me:**

## Stage 1 — scaffold, generator, normalization (17:55–18:15)

- **AI proposed:** Vite 8 + React 19 + TS strict, Vitest + fast-check, Playwright (no retries),
  ESLint flat config, CI workflow, a script that saves test output with a header (command, commit,
  exit code). Generator with a ground-truth manifest; normalization with last-write-wins for
  duplicates; an independent oracle in `tests/reference/`; property tests; a cross-check that
  normalization rediscovers every injected defect of the 20 catalogue runs.
- **Accepted:** as proposed.
- **Changed:** pinned TypeScript 6.0.3 instead of the latest 7.0.2 (see decisions E1).
- **What was checked and how:** tests were written first and run red (module missing) before each
  implementation. Afterwards a manual mutation check on `normalize.ts`: three injected bugs
  (first-write-wins, `>=` in the gap rule, NaN → 0) — each made tests fail. The `>=` mutation was
  caught only by the oracle comparison, so an explicit boundary test was added and verified to fail
  on that mutation and pass on the real code.
- **Where AI was wrong:**
  - used the legacy `reactHooks.configs['recommended-latest']` in the flat ESLint config → ESLint
    crashed; fixed to `configs.flat['recommended-latest']`;
  - first picked TypeScript 7.0.2, which `typescript-eslint` does not support (found from peer deps
    before installing);
  - wrote a generator test expecting negative loss with an offset of 2.5, but the clean curve ends
    at ≈ 2.65, so it could never go negative; noticed while writing the catalogue, before running;
  - left an unused variable in the first draft of `generate.ts` (removed before the first run);
  - added redundant `!` non-null assertions on typed-array reads (69 lint errors) although
    `noUncheckedIndexedAccess` is off by its own decision E2; removed;
  - the output-saving script needed three iterations: its "dirty tree" flag fired because of the
    results file it had just written itself, and its colour handling was wrong twice (Vitest turns
    colours *on* when `FORCE_COLOR` is merely present, even `FORCE_COLOR=0`; Playwright sets
    `FORCE_COLOR` for its children, so a global `NO_COLOR` produced Node warnings). Each iteration
    is a separate commit.
- **Verified by me:**
