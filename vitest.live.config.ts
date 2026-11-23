import { defineConfig } from 'vitest/config';

// Opt-in: hits the real provider sites (AIDA opens a visible browser window). Not part of CI.
export default defineConfig({
  test: { include: ['collector/**/*.live.test.ts'], environment: 'node', testTimeout: 300_000, hookTimeout: 60_000 },
});
