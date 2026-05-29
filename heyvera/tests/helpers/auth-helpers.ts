import { Page } from '@playwright/test';

export interface MockUser {
  id: string;
  fullName?: string;
  username?: string;
  primaryEmailAddress?: {
    emailAddress: string;
  };
}

export interface MockProfile {
  id: string;
  accountId: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  websiteUrl: string | null;
}

/**
 * Mock signed-out user state (no Clerk auth)
 */
export async function mockSignedOutUser(page: Page) {
  await page.addInitScript(() => {
    // Mock window.Clerk to return signed-out state
    (window as any).__CLERK_PUBLISHABLE_KEY = 'pk_test_mock';
    (window as any).Clerk = {
      user: null,
      session: null,
      isSignedIn: false,
    };
  });

  // Mock API calls to return unauthenticated responses
  await page.route('**/api/social/**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorized' }),
    });
  });

  await page.route('**/api/profile/**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorized' }),
    });
  });
}

/**
 * Mock signed-in user with no profile
 */
export async function mockSignedInUserNoProfile(page: Page, user: MockUser) {
  await page.addInitScript((mockUser) => {
    (window as any).__CLERK_PUBLISHABLE_KEY = 'pk_test_mock';
    (window as any).Clerk = {
      user: mockUser,
      session: { id: 'sess_test', getToken: () => Promise.resolve('mock-token') },
      isSignedIn: true,
    };
  }, user);

  // Mock profile fetch to return 404 (no profile exists)
  await page.route('**/api/profile/me', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Profile not found' }),
    });
  });

  // Mock profile creation endpoint
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() === 'POST') {
      const body = await route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'prof_' + Date.now(),
          accountId: user.id,
          displayName: body.displayName,
          handle: body.handle,
          bio: body.bio || '',
          avatarUrl: null,
          bannerUrl: null,
          location: null,
          websiteUrl: null,
        }),
      });
    }
  });
}

/**
 * Mock signed-in user with existing profile
 */
export async function mockSignedInUserWithProfile(page: Page, user: MockUser, profile: MockProfile) {
  await page.addInitScript((mockUser) => {
    (window as any).__CLERK_PUBLISHABLE_KEY = 'pk_test_mock';
    (window as any).Clerk = {
      user: mockUser,
      session: { id: 'sess_test', getToken: () => Promise.resolve('mock-token') },
      isSignedIn: true,
    };
  }, user);

  // Mock profile fetch to return existing profile
  await page.route('**/api/profile/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    });
  });

  // Mock feed endpoint
  await page.route('**/api/social/feed**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        posts: [
          {
            id: 'post_1',
            content: 'Welcome to HeyVera! This is your first post.',
            authorDisplayName: 'HeyVera',
            authorHandle: 'heyvera',
            authorAvatarUrl: null,
            createdAt: new Date().toISOString(),
            likeCount: 5,
            repostCount: 2,
            replyCount: 1,
            isLiked: false,
            isReposted: false,
          },
        ],
        nextCursor: null,
      }),
    });
  });

  // Mock post creation
  await page.route('**/api/social/posts', async (route) => {
    if (route.request().method() === 'POST') {
      const body = await route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'post_' + Date.now(),
          content: body.content,
          authorDisplayName: profile.displayName,
          authorHandle: profile.handle,
          authorAvatarUrl: profile.avatarUrl,
          createdAt: new Date().toISOString(),
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          isLiked: false,
          isReposted: false,
        }),
      });
    }
  });

  // Mock social actions (like, follow, repost)
  await page.route('**/api/social/posts/*/like', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route('**/api/social/posts/*/repost', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route('**/api/social/profiles/*/follow', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

/**
 * Common setup for all tests - mock external services
 */
export async function setupCommonMocks(page: Page) {
  // Mock Dicebear avatars
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

  // Mock Unsplash images
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

  // Disable animations for consistent screenshots
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

  // Fix date for consistent timestamps
  await page.addInitScript(() => {
    const FIXED_NOW = 1_730_491_200_000;
    const OriginalDate = Date;

    class MockDate extends OriginalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(FIXED_NOW);
          return;
        }
        // @ts-ignore: Spread args handled by any[] type above
        super(...args);
      }

      static now() {
        return FIXED_NOW;
      }
    }

    Object.defineProperty(window, 'Date', {
      value: MockDate,
      configurable: true,
    });
  });
}

/**
 * Take screenshot for visual regression testing
 */
export async function takeScreenshot(page: Page, testInfo: any, screenshotName: string) {
  const projectName = testInfo.project.name;
  await page.screenshot({
    path: `/home/runner/workspace/web/tests/screenshots/${screenshotName}-${projectName}.png`,
    fullPage: false,
  });
}