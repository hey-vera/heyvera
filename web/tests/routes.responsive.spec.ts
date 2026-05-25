import { expect, test } from '@playwright/test';

const FIXED_NOW = 1_730_491_200_000;

const routes = [
  { path: '/home', readyText: 'For you' },
  { path: '/explore', readyText: 'Trending' },
  { path: '/notifications', readyText: 'Notifications' },
  { path: '/messages', readyText: 'Messages' },
  { path: '/profile/vera', readyText: 'Follow' },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixedNow) => {
    const OriginalDate = Date;

    class MockDate extends OriginalDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        if (args.length === 0) {
          super(fixedNow);
          return;
        }

        super(...args);
      }

      static now() {
        return fixedNow;
      }
    }

    Object.defineProperty(window, 'Date', {
      value: MockDate,
      configurable: true,
    });
  }, FIXED_NOW);

  await page.route('https://api.dicebear.com/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
        '<rect width="128" height="128" fill="#1f2937"/>',
        '<circle cx="64" cy="48" r="24" fill="#9ca3af"/>',
        '<rect x="24" y="84" width="80" height="28" rx="14" fill="#6b7280"/>',
        '</svg>',
      ].join(''),
    });
  });

  await page.route('https://images.unsplash.com/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">',
        '<rect width="1200" height="400" fill="#111827"/>',
        '<rect x="0" y="280" width="1200" height="120" fill="#0f766e"/>',
        '<circle cx="1040" cy="96" r="72" fill="#22c55e" fill-opacity="0.35"/>',
        '</svg>',
      ].join(''),
    });
  });
});

for (const route of routes) {
  test(`renders ${route.path} and captures the responsive viewport`, async ({ page }, testInfo) => {
    await page.goto(route.path);
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(main.getByText(route.readyText, { exact: true }).first()).toBeVisible();
    await page.addStyleTag({
      content: `
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `,
    });
    await page.screenshot({
      path: testInfo.outputPath(
        `${route.path.replaceAll('/', '_').replace(/^_/, '') || 'root'}-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });
  });
}
