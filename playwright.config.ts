import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E runs against a throwaway data directory so it never touches real data.
// Absolute: each workspace package runs with its own cwd.
const dataDir = path.resolve('.tmp/e2e-data');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf ${dataDir} && pnpm dev`,
    url: 'http://localhost:5173/api/health', // proxied: ready only once API and web are both up
    reuseExistingServer: false,
    timeout: 60_000,
    // Mock collectors: deterministic and never touches the provider websites.
    env: { CRUISE_DATA_DIR: dataDir, COLLECTOR_MODE: 'mock', COREPACK_INTEGRITY_KEYS: '0' },
  },
});
