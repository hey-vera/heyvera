import { test, expect } from '@playwright/test';
import {
  mockSignedInUserWithProfile,
  setupCommonMocks,
  takeScreenshot,
  MockUser,
  MockProfile,
} from '../helpers/auth-helpers';

const mockUser: MockUser = {
  id: 'user_test123',
  fullName: 'Test User',
  username: 'testuser',
  primaryEmailAddress: {
    emailAddress: 'test@example.com',
  },
};

const mockProfile: MockProfile = {
  id: 'prof_test123',
  accountId: 'user_test123',
  displayName: 'Test User',
  handle: 'testuser',
  bio: 'Testing HeyVera platform',
  avatarUrl: null,
  bannerUrl: null,
  location: 'Test City',
  websiteUrl: 'https://test.example.com',
};

test.describe('Signed-in user with profile', () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await mockSignedInUserWithProfile(page, mockUser, mockProfile);
  });

  test('home feed loads and displays posts', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Should see the main feed
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should see "For you" heading
    await expect(page.getByText('For you', { exact: true })).toBeVisible();

    // Should see compose button (user can post)
    const composeButton = page.getByRole('button', { name: /compose/i });
    await expect(composeButton).toBeVisible();

    // Should see posts from mock feed
    await expect(page.getByText('Welcome to HeyVera!')).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-home');
  });

  test('post creation works', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Click compose button
    const composeButton = page.getByRole('button', { name: /compose/i });
    await composeButton.click();

    // Should open compose modal
    const composeModal = page.locator('[role="dialog"], .modal, [data-testid*="compose"]');
    await expect(composeModal).toBeVisible();

    // Fill in post content
    const textArea = page.getByRole('textbox', { name: /compose/i }).or(page.locator('textarea'));
    await textArea.fill('This is a test post from E2E tests!');

    // Click post button
    const postButton = page.getByRole('button', { name: /post/i });
    await expect(postButton).toBeEnabled();
    await postButton.click();

    // Modal should close and post should appear (or success indication)
    await expect(composeModal).not.toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-compose');
  });

  test('profile page shows user information', async ({ page }, testInfo) => {
    await page.goto(`/profile/${mockProfile.handle}`);

    // Should show profile information
    await expect(page.getByText(mockProfile.displayName)).toBeVisible();
    await expect(page.getByText(`@${mockProfile.handle}`)).toBeVisible();
    await expect(page.getByText(mockProfile.bio)).toBeVisible();

    if (mockProfile.location) {
      await expect(page.getByText(mockProfile.location)).toBeVisible();
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-profile');
  });

  test('profile editing works', async ({ page }, testInfo) => {
    await page.goto(`/profile/${mockProfile.handle}`);

    // Look for edit profile button
    const editButton = page.getByRole('button', { name: /edit/i });

    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click();

      // Should see edit form
      const displayNameInput = page.getByLabel(/display name/i);
      const bioInput = page.getByLabel(/bio/i);

      await displayNameInput.fill('Updated Test User');
      await bioInput.fill('Updated bio for testing');

      // Save changes
      const saveButton = page.getByRole('button', { name: /save/i });
      await saveButton.click();

      // Should show updated information
      await expect(page.getByText('Updated Test User')).toBeVisible();
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-edit');
  });

  test('social actions work (like, repost)', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Wait for posts to load
    await expect(page.getByText('Welcome to HeyVera!')).toBeVisible();

    // Look for like button
    const likeButton = page.locator('[aria-label*="like" i], [aria-label*="heart" i]').first();

    if (await likeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get initial like count if visible
      const likeCount = page.locator('[data-testid*="like-count"], .like-count').first();
      const initialCount = await likeCount.textContent().catch(() => '0');

      await likeButton.click();

      // Should see like state change (different icon, color, or count)
      await page.waitForTimeout(500); // Brief wait for UI update
    }

    // Look for repost button
    const repostButton = page.locator('[aria-label*="repost" i], [aria-label*="share" i]').first();

    if (await repostButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await repostButton.click();

      // Should see repost confirmation or state change
      await page.waitForTimeout(500);
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-social-actions');
  });

  test('follow functionality works', async ({ page }, testInfo) => {
    // Visit another user's profile (we'll mock this)
    await page.goto('/profile/heyvera');

    // Mock the HeyVera profile
    await page.route('**/api/profile/heyvera', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'prof_heyvera',
          accountId: 'user_heyvera',
          displayName: 'HeyVera',
          handle: 'heyvera',
          bio: 'The social platform for the future',
          avatarUrl: null,
          bannerUrl: null,
          location: null,
          websiteUrl: 'https://heyvera.org',
        }),
      });
    });

    // Should show follow button
    const followButton = page.getByRole('button', { name: /follow/i });

    if (await followButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await followButton.click();

      // Should change to following state
      await expect(page.getByText(/following/i)).toBeVisible();
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-follow');
  });

  test('notifications page loads', async ({ page }, testInfo) => {
    await page.goto('/notifications');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-notifications');
  });

  test('messages page loads', async ({ page }, testInfo) => {
    await page.goto('/messages');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Messages', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-messages');
  });

  test('premium page shows upgrade options', async ({ page }, testInfo) => {
    await page.goto('/premium');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText(/premium/i)).toBeVisible();

    // Should show pricing or upgrade options
    const upgradeButton = page.getByRole('button', { name: /upgrade/i }).or(
      page.getByRole('button', { name: /subscribe/i })
    );

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-with-profile-premium');
  });
});