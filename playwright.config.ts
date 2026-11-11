import { defineConfig, devices } from '@playwright/test';

// A port of its own (not vite preview's default 4173): a preview server left running by hand must
// never be picked up silently, so every e2e run builds and serves the current code.
const PORT = 4317;

// E2E_BASE_URL=https://… runs the same tests against a deployed site (no local server).
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries on purpose: a retry would turn a flaky (i.e. real) failure into a quiet pass.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: REMOTE ? undefined : {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
