# HeyVera E2E Test Suite

This directory contains end-to-end tests for the HeyVera frontend application using Playwright.

## Test Structure

### E2E Tests (`tests/e2e/`)
- `signed-out.spec.ts` - Tests for unauthenticated users
- `signed-in-no-profile.spec.ts` - Tests for authenticated users without profiles
- `signed-in-with-profile.spec.ts` - Tests for authenticated users with profiles
- `visual-regression.spec.ts` - Visual regression tests across viewport sizes

### Test Helpers (`tests/helpers/`)
- `auth-helpers.ts` - Mock authentication states and common setup functions

### Screenshots (`tests/screenshots/`)
- Baseline screenshots stored by viewport size (mobile, tablet, desktop)
- Generated automatically during visual regression tests

## Running Tests

### All E2E Tests
```bash
npm run test:e2e
```

### Visual Regression Tests Only
```bash
npm run test:visual
```

### All Tests (including responsive layout tests)
```bash
npm run test:responsive
```

### Run in UI Mode (for debugging)
```bash
npx playwright test --ui
```

## Test Configuration

Tests run against the local dev server on `http://localhost:5001` with three viewport configurations:

- **Mobile**: 375x667 (iPhone-like)
- **Tablet**: 768x1024 (iPad-like) 
- **Desktop**: 1440x900 (laptop/desktop)

## Mock Data

Tests use comprehensive mocking for:
- Clerk authentication states
- API responses for social features
- External services (Dicebear avatars, Unsplash images)
- Fixed timestamps for consistent screenshots

## Test Coverage

### Signed-out Users
- ✅ Can view public feed
- ✅ Cannot post or interact
- ✅ Auth redirects work
- ✅ Public pages accessible

### Signed-in Without Profile
- ✅ Auth works and user recognized
- ✅ Profile creation flow
- ✅ Blocked from social features until profile exists
- ✅ Public pages still accessible

### Signed-in With Profile
- ✅ Home feed loads with posts
- ✅ Post creation works
- ✅ Profile page shows information
- ✅ Profile editing functionality
- ✅ Social actions (like, repost, follow)
- ✅ All authenticated pages accessible

### Visual Regression
- ✅ Key pages captured at all viewport sizes
- ✅ Compose modal responsiveness
- ✅ Consistent styling across devices

## Adding New Tests

1. Create test file in `tests/e2e/`
2. Import helpers from `../helpers/auth-helpers`
3. Use `setupCommonMocks()` in beforeEach
4. Choose appropriate auth state mock function
5. Use `takeScreenshot()` for visual regression coverage

## CI Integration

Tests are configured to run in CI environments with:
- Headless browser mode
- HTML and list reporters
- Trace collection on first retry
- Screenshot artifacts on failure