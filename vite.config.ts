import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Cross-origin isolation: required by performance.measureUserAgentSpecificMemory(), the only
// in-page memory API that counts Web Workers and ArrayBuffers (perf/experiments, part C).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    environment: 'node',
    // The 1M-point generator/normalizer tests take a few seconds under load.
    testTimeout: 30_000,
  },
});
