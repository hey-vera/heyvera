import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/db/index.ts', 'src/routes/escrow.ts', 'src/routes/governance.ts'],
      reporter: ['text', 'lcov'],
    },
    // Each test file runs in its own context so DB mocks don't bleed across
    isolate: true,
    testTimeout: 10000,
  },
});
