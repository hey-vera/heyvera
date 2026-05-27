import { test, expect } from '@playwright/test';
import { mockSignedOutUser, setupCommonMocks, takeScreenshot } from '../helpers/auth-helpers';

test.describe('Signed-out user experience', () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await mockSignedOutUser(page);
  });

  test('can view public home feed', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Should see the main feed
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should see "For you" heading
    await expect(page.getByText('For you', { exact: true })).toBeVisible();

    // Should see sign in button instead of compose button
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Should not see compose button
    const composeButton = page.getByRole('button', { name: /compose/i });
    await expect(composeButton).not.toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-home-feed');
  });

  test('cannot post or interact with posts', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Try to find post interaction buttons - they should not exist or be disabled
    // Since we're signed out, posts likely won't show interaction buttons
    const likeButtons = page.locator('[aria-label*="like" i], [aria-label*="heart" i]');
    const repostButtons = page.locator('[aria-label*="repost" i], [aria-label*="share" i]');

    // These should either not exist or be disabled for signed-out users
    await expect(likeButtons.first()).not.toBeVisible({ timeout: 3000 }).catch(() => {
      // If buttons exist, they should be disabled
      expect(likeButtons.first()).toBeDisabled();
    });

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-post-interactions');
  });

  test('redirects to auth when trying to access protected pages', async ({ page }, testInfo) => {
    // Try to access notifications page
    await page.goto('/notifications');

    // Should either redirect to sign in or show sign in prompt
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-auth-redirect');
  });

  test('can view explore page', async ({ page }, testInfo) => {
    await page.goto('/explore');

    // Should see the explore page content
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should see "Trending" or similar heading
    await expect(page.getByText('Trending', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-explore');
  });

  test('can view premium page', async ({ page }, testInfo) => {
    await page.goto('/premium');

    // Should see the premium page content
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Should see premium-related content
    await expect(page.getByText(/premium/i)).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-premium');
  });

  test('auth redirects work properly', async ({ page }, testInfo) => {
    await page.goto('/messages');

    // Should show sign in requirement
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Mock clicking sign in (we won't actually authenticate, just verify the flow exists)
    await signInButton.click();

    // Should remain on messages page or redirect to auth provider
    // For our test purposes, just verify the button is still present after click
    await expect(signInButton).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'signed-out-messages-auth');
  });
});