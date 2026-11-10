/**
 * Expected values for e2e tests, computed in Node from the same seeded generator but through the
 * brute-force oracles in tests/reference — NOT through the app's normalize/summarize code.
 */
import { generateRun } from '../src/core/generate.ts';
import { RUN_SPECS } from '../src/core/runSpecs.ts';
import { normalizeOracle } from '../tests/reference/normalizeOracle.ts';
import { summaryOracle } from '../tests/reference/summaryOracle.ts';

export function expectedRun(id: string) {
  const spec = RUN_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`unknown run ${id}`);
  const { raw, truth } = generateRun(spec);
  const normalized = normalizeOracle(raw);
  return { spec, truth, summary: summaryOracle(normalized) };
}
