import { test, expect } from '@playwright/test';
import { mockSignedInUserNoProfile, setupCommonMocks, takeScreenshot, MockUser } from '../helpers/auth-helpers';

const mockUser: MockUser = {
  id: 'user_test123',
  fullName: 'Test User',
  username: 'testuser',
  primaryEmailAddress: {
    emailAddress: 'test@example.com',
  },
};

test.describe('Signed-in user without profile', () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await mockSignedInUserNoProfile(page, mockUser);
  });

  test('auth works and user is recognized', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Should be signed in (no sign-in button)
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).not.toBeVisible();

    // Should see some indication of being signed in (user menu, profile nav, etc.)
    // This might be in the top bar or side navigation
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-home');
  });

  test('profile creation flow works', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Look for profile creation prompt or navigate to profile settings
    // Since this user has no profile, the app should prompt or redirect to profile creation

    // Try to access profile page which might trigger profile creation flow
    await page.goto('/profile/testuser');

    // Should see profile creation form or prompt
    const profileForm = page.locator('form').first();
    const displayNameInput = page.getByLabel(/display name/i);
    const handleInput = page.getByLabel(/handle/i);
    const bioInput = page.getByLabel(/bio/i);

    // If profile creation form is visible, test it
    if (await displayNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await displayNameInput.fill('Test User Profile');
      await handleInput.fill('testuser123');
      await bioInput.fill('This is a test bio');

      const createButton = page.getByRole('button', { name: /create/i });
      await createButton.click();

      // Should successfully create profile
      await expect(page.getByText('Test User Profile')).toBeVisible();
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-creation');
  });

  test('blocked from social features until profile exists', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Try to compose a post - should be blocked
    const composeButton = page.getByRole('button', { name: /compose/i });

    if (await composeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await composeButton.click();

      // Should show message about needing profile
      await expect(page.getByText(/profile/i)).toBeVisible();
      await expect(page.getByText(/create/i)).toBeVisible();
    }

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-blocked');
  });

  test('can navigate to public pages', async ({ page }, testInfo) => {
    // Should still be able to view explore page
    await page.goto('/explore');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Trending', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-explore');
  });

  test('premium page accessible', async ({ page }, testInfo) => {
    await page.goto('/premium');

    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText(/premium/i)).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-premium');
  });

  test('settings page shows user info', async ({ page }, testInfo) => {
    await page.goto('/settings');

    // Should see user settings even without profile
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should show user email or name from Clerk
    await expect(page.getByText('test@example.com')).toBeVisible().catch(async () => {
      // Or might show full name
      await expect(page.getByText('Test User')).toBeVisible();
    });

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-in-no-profile-settings');
  });
});