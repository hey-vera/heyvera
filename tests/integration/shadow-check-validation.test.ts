/**
 * Integration test — shadow-check end-to-end validation.
 *
 * Exercises four paths through the shadow-check middleware with a
 * real in-memory SQLite DB, a real ClawNetApiKeyBackend, and a
 * minimal Hono app wired with checkApiKey + rotationShadowCheck.
 *
 * Paths tested:
 *   1. Adopted cn- key       → shadowCheck: "match"
 *   2. Env key (API_KEYS)    → shadowCheck: "skipped"
 *   3. Admin key             → shadowCheck: "skipped"
 *   4. Delegated key         → shadowCheck: "skipped"
 *
 * For path 1, checkApiKey must pass without the bearer being in
 * API_KEYS (so the env-key skip doesn't fire). We achieve this by
 * adding the adopted bearer to API_KEYS for auth but NOT including
 * it in the shadow-check's env-key list — actually, since both read
 * the same env.API_KEYS, we use the admin key to bypass checkApiKey
 * for the non-admin paths by leaving API_KEYS empty (checkApiKey
 * passes when API_KEYS is unset). Each test configures its own env.
 */

import {
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { Hono } from 'hono';

// Mock the logger before source imports.
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { checkApiKey } from '../../src/middleware/auth';
import { rotationShadowCheck } from '../../src/middleware/rotation-shadow-check';
import {
  _resetRotationBackendForTests,
  getRotationBackend,
} from '../../src/core/rotation-backend';
import { _resetDbForTests, closeDb, getDb, initDb } from '../../src/db/index';
import { env } from '../../src/config/index';
import { logger } from '../../src/utils/logger';

const testEnv = env as unknown as Record<string, string | undefined>;

const ADOPTED_BEARER = 'cn-' + 'c'.repeat(48);
const ENV_KEY = 'env-key-integration-test';
const ADMIN_KEY = 'admin-key-integration-test';
const DELEGATED_KEY = 'del-integration-test-001';
const PARENT_KEY = 'cn-' + 'b'.repeat(48);

function makeApp() {
  const app = new Hono();
  app.use('*', checkApiKey);
  app.use('*', rotationShadowCheck);
  app.get('/test', (c) => c.text('ok'));
  return app;
}

beforeEach(() => {
  _resetDbForTests();
  initDb({ path: ':memory:' });
  _resetRotationBackendForTests();
  vi.clearAllMocks();
  testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
  testEnv.API_KEYS = undefined;
  testEnv.ADMIN_API_KEY = undefined;
});

afterEach(() => {
  closeDb();
  testEnv.ROTATION_SHADOW_CHECK_ENABLED = undefined;
  testEnv.API_KEYS = undefined;
  testEnv.ADMIN_API_KEY = undefined;
  vi.restoreAllMocks();
});

// ─── Path 1: Adopted cn- key → match ────────────────────────────────────────

describe('shadow-check integration — adopted cn- key', () => {
  it('produces shadowCheck: "match"', async () => {
    // Leave API_KEYS unset so checkApiKey passes all bearers through.
    // Adopt the bearer into the rotation backend.
    getRotationBackend().adoptPreVerifiedBearer({
      bearer: ADOPTED_BEARER,
      identityId: 'id-integration-adopted',
      issuedAt: Date.now(),
      ttlMs: 600_000,
    });

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': ADOPTED_BEARER },
    });

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'match' });
  });
});

// ─── Path 2: Env key → skipped ──────────────────────────────────────────────

describe('shadow-check integration — env key', () => {
  it('produces shadowCheck: "skipped"', async () => {
    testEnv.API_KEYS = ENV_KEY;

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': ENV_KEY },
    });

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });
});

// ─── Path 3: Admin key → skipped ────────────────────────────────────────────

describe('shadow-check integration — admin key', () => {
  it('produces shadowCheck: "skipped"', async () => {
    testEnv.ADMIN_API_KEY = ADMIN_KEY;

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });
});

// ─── Path 4: Delegated key → skipped ────────────────────────────────────────

describe('shadow-check integration — delegated key', () => {
  it('produces shadowCheck: "skipped"', async () => {
    // Leave API_KEYS unset so checkApiKey passes all bearers.
    const db = getDb();
    // Insert the parent api_keys row (FK constraint).
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, amount_paid)
       VALUES (?, ?, 0, 0)`,
    ).run(PARENT_KEY, 'test@example.com');
    // Insert the delegated key.
    db.prepare(
      `INSERT INTO delegated_keys (key, account_key, parent_key, depth, max_depth)
       VALUES (?, ?, ?, 1, 0)`,
    ).run(DELEGATED_KEY, PARENT_KEY, PARENT_KEY);

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': DELEGATED_KEY },
    });

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });
});
