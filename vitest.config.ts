import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 'forks' pool required on Windows — vmThreads (default) fails to initialise
    // pool workers in vitest 4.x on Windows due to worker_threads communication issues.
    pool: 'forks',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // src/db/index.ts is a barrel re-export; actual implementations are in domain files.
      // Include all domain files so coverage reflects real function-level coverage.
      include: ['src/db/**/*.ts', 'src/routes/escrow.ts', 'src/routes/governance.ts'],
      reporter: ['text', 'lcov'],
    },
    // Each test file runs in its own context so DB mocks don't bleed across
    isolate: true,
    testTimeout: 10000,
  },
});
