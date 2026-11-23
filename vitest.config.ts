import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'apps/frontend/src') } },
  test: {
    include: ['{packages,collector,apps}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'collector/playwright/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        // test helpers
        'packages/analytics/src/testing.ts',
        'collector/playwright/src/__fixtures__/**',
        // Entry points: thin wiring around code that is tested.
        '**/cli/**',
        'apps/api/src/server.ts',
        'apps/api/src/auth-cli.ts',
        // Drive the real provider websites; covered by the opt-in live test (pnpm test:live), not by CI.
        'collector/playwright/src/collectors/AidaCollector.ts',
        'collector/playwright/src/collectors/MeinSchiffCollector.ts',
        'collector/playwright/src/collectors/browserSteps.ts',
      ],
      reporter: ['text-summary', 'text'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
        // Epic 15 targets: analytics 95%, forecasting / recommendations / alerts 90%.
        'packages/analytics/src/**': { lines: 95, functions: 95, statements: 95, branches: 90 },
        'packages/analytics/src/forecast.ts': { lines: 90, functions: 90, statements: 90, branches: 90 },
        'packages/analytics/src/recommendation.ts': { lines: 90, functions: 90, statements: 90, branches: 90 },
        'packages/analytics/src/alerts.ts': { lines: 90, functions: 90, statements: 90, branches: 90 },
      },
    },
  },
});
