import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        ...devices['iPhone 13'],
      },
    },
    {
      name: 'tablet',
      use: {
        browserName: 'chromium',
        ...devices['iPad Pro 11'],
      },
    },
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1100 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
