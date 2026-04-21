import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration — unit test harness for ClawNet.
 *
 * This is the foundation PR of the rotation-on-main migration. The
 * existing `tests/run.ts` HTTP harness (invoked via `npm test`) stays
 * in place and keeps running against a live server for end-to-end
 * checks. `npm run test:unit` is the isolated, server-less surface
 * that upcoming crypto / DB / backend PRs will ride on top of.
 *
 * Scope is deliberately narrow: only `tests/unit/**` is picked up, so
 * vitest never accidentally tries to run `tests/run.ts` (which is not
 * structured as a vitest suite).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
