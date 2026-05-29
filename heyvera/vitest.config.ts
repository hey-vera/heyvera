import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
  },
});
