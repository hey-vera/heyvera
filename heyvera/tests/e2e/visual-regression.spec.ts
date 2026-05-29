import { test, expect } from '@playwright/test';
import {
  mockSignedInUserWithProfile,
  setupCommonMocks,
  takeScreenshot,
  MockUser,
  MockProfile,
} from '../helpers/auth-helpers';

const mockUser: MockUser = {
  id: 'user_visual_test',
  fullName: 'Visual Test User',
  username: 'visualuser',
  primaryEmailAddress: {
    emailAddress: 'visual@example.com',
  },
};

const mockProfile: MockProfile = {
  id: 'prof_visual_test',
  accountId: 'user_visual_test',
  displayName: 'Visual Test User',
  handle: 'visualuser',
  bio: 'Testing visual regressions across viewport sizes',
  avatarUrl: null,
  bannerUrl: null,
  location: 'Visual City',
  websiteUrl: 'https://visual.example.com',
};

test.describe('Visual regression screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    await mockSignedInUserWithProfile(page, mockUser, mockProfile);
  });

  test('home feed at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Wait for content to load
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('For you', { exact: true })).toBeVisible();

    // Wait for posts to render
    await expect(page.getByText('Welcome to HeyVera!')).toBeVisible();

    // Take screenshot for current viewport
    await takeScreenshot(page, testInfo, 'home-feed');
  });

  test('profile page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto(`/profile/${mockProfile.handle}`);

    // Wait for profile content to load
    await expect(page.getByText(mockProfile.displayName)).toBeVisible();
    await expect(page.getByText(`@${mockProfile.handle}`)).toBeVisible();
    await expect(page.getByText(mockProfile.bio)).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'profile-page');
  });

  test('premium page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/premium');

    // Wait for premium page content
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText(/premium/i)).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'premium-page');
  });

  test('compose modal at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/home');

    // Open compose modal
    const composeButton = page.getByRole('button', { name: /compose/i });
    await expect(composeButton).toBeVisible();
    await composeButton.click();

    // Wait for modal to open
    const composeModal = page.locator('[role="dialog"], .modal, [data-testid*="compose"]');
    await expect(composeModal).toBeVisible();

    // Add some sample text
    const textArea = page.getByRole('textbox', { name: /compose/i }).or(page.locator('textarea'));
    await textArea.fill('Sample compose text for visual testing across different viewport sizes. This helps us see how the modal adapts to mobile, tablet, and desktop layouts.');

    // Take screenshot with modal open
    await takeScreenshot(page, testInfo, 'compose-modal');
  });

  test('explore page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/explore');

    // Wait for explore content
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Trending', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'explore-page');
  });

  test('notifications page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/notifications');

    // Wait for notifications content
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'notifications-page');
  });

  test('messages page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/messages');

    // Wait for messages content
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(page.getByText('Messages', { exact: true })).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'messages-page');
  });

  test('settings page at all viewport sizes', async ({ page }, testInfo) => {
    await page.goto('/settings');

    // Wait for settings content
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Take screenshot
    await takeScreenshot(page, testInfo, 'settings-page');
  });
});