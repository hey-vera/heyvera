/**
 * Unit tests — G7.3 rotation shadow-check middleware.
 *
 * Covers:
 *   - kill-switch: flag absent → zero rotation-backend calls, request passes
 *   - env-key skip: bearer matching API_KEYS → skipped, no lookup
 *   - env-key whitespace: split/trim/filter mirrors checkApiKey exactly
 *   - delegated-key skip: bearer in delegated_keys → skipped, no lookup
 *   - match: bearer adopted in rotation backend → 'match'
 *   - notAdopted: bearer not in rotation backend → 'notAdopted'
 *   - no bearer in request: no lookup
 *   - error resilience: thrown lookupByBearer → 'error', request unblocked
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

// Mock the logger before any source imports so the middleware gets the mock.
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { rotationShadowCheck } from '../../src/middleware/rotation-shadow-check';
import {
  _resetRotationBackendForTests,
  getRotationBackend,
} from '../../src/core/rotation-backend';
import { ClawNetApiKeyBackend } from '../../src/core/api-key-rotation';
import { _resetDbForTests, closeDb, getDb, initDb } from '../../src/db/index';
import { env } from '../../src/config/index';
import { logger } from '../../src/utils/logger';

// Mutable cast so tests can set optional env fields without TS complaints.
const testEnv = env as unknown as Record<string, string | undefined>;

// A valid cn-[a-f0-9]{48} bearer for tests that need one in the rotation path.
const VALID_CN_BEARER = 'cn-' + 'a'.repeat(48);

function makeApp() {
  const app = new Hono();
  app.use('*', rotationShadowCheck);
  app.get('/test', (c) => c.text('ok'));
  return app;
}

beforeEach(() => {
  _resetDbForTests();
  initDb({ path: ':memory:' });
  _resetRotationBackendForTests();
  vi.clearAllMocks();
  // Ensure flag is off by default; individual tests opt in.
  testEnv.ROTATION_SHADOW_CHECK_ENABLED = undefined;
  testEnv.API_KEYS = undefined;
});

afterEach(() => {
  closeDb();
  testEnv.ROTATION_SHADOW_CHECK_ENABLED = undefined;
  testEnv.API_KEYS = undefined;
  vi.restoreAllMocks();
});

// ─── Kill-switch ─────────────────────────────────────────────────────────────

describe('rotationShadowCheck — kill-switch', () => {
  it('flag absent: request passes, zero rotation-backend calls', async () => {
    // ROTATION_SHADOW_CHECK_ENABLED is undefined (default off).
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': VALID_CN_BEARER },
    });

    expect(res.status).toBe(200);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('flag set to empty string: still treated as off', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = '';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    await makeApp().request('/test', { headers: { 'X-API-Key': VALID_CN_BEARER } });

    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

// ─── Env-key skip ────────────────────────────────────────────────────────────

describe('rotationShadowCheck — env-key skip', () => {
  it('bearer matching an env key is skipped without a rotation lookup', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = 'env-key-alpha,env-key-beta';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    await makeApp().request('/test', { headers: { 'X-API-Key': 'env-key-alpha' } });

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });

  it('mirrors checkApiKey split/trim/filter: whitespace around env keys is trimmed', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '  spaced-key  , other-key ';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    await makeApp().request('/test', { headers: { 'X-API-Key': 'spaced-key' } });

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });

  it('bearer NOT matching any env key proceeds to rotation lookup', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = 'other-key';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    await makeApp().request('/test', { headers: { 'X-API-Key': VALID_CN_BEARER } });

    expect(lookupSpy).toHaveBeenCalledOnce();
  });
});

// ─── Delegated-key skip ──────────────────────────────────────────────────────

describe('rotationShadowCheck — delegated-key skip', () => {
  it('bearer found in delegated_keys is skipped without a rotation lookup', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';

    const parentKey = 'cn-' + 'b'.repeat(48);
    const delegatedKey = 'del-test-key-001';
    const db = getDb();
    // Insert the parent api_keys row to satisfy the FK constraint.
    db.prepare(
      `INSERT INTO api_keys (key, email, credits, amount_paid) VALUES (?, ?, 0, 0)`,
    ).run(parentKey, 'test@example.com');
    db.prepare(
      `INSERT INTO delegated_keys (key, account_key, parent_key, depth, max_depth)
       VALUES (?, ?, ?, 1, 0)`,
    ).run(delegatedKey, parentKey, parentKey);

    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');
    await makeApp().request('/test', { headers: { 'X-API-Key': delegatedKey } });

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'skipped' });
  });

  it('bearer NOT in delegated_keys proceeds to rotation lookup', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    await makeApp().request('/test', { headers: { 'X-API-Key': VALID_CN_BEARER } });

    expect(lookupSpy).toHaveBeenCalledOnce();
  });
});

// ─── Match / notAdopted ──────────────────────────────────────────────────────

describe('rotationShadowCheck — match / notAdopted', () => {
  it('adopted bearer logs match', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';

    // Adopt the bearer into the rotation backend before the request.
    // getRotationBackend() creates the singleton against the in-memory DB.
    const now = Date.now();
    getRotationBackend().adoptPreVerifiedBearer({
      bearer: VALID_CN_BEARER,
      identityId: 'id-shadow-match-test',
      issuedAt: now,
      ttlMs: 600_000,
    });

    await makeApp().request('/test', { headers: { 'X-API-Key': VALID_CN_BEARER } });

    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'match' });
  });

  it('bearer not in rotation backend logs notAdopted', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';

    // No adoption — bearer is unknown to the rotation backend.
    await makeApp().request('/test', { headers: { 'X-API-Key': VALID_CN_BEARER } });

    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'notAdopted' });
  });

  it('no X-API-Key header: no rotation lookup', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    const lookupSpy = vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer');

    const res = await makeApp().request('/test');

    expect(res.status).toBe(200);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

// ─── Error resilience ────────────────────────────────────────────────────────

describe('rotationShadowCheck — error resilience', () => {
  it('a thrown error in lookupByBearer logs error and does not block the request', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';

    vi.spyOn(ClawNetApiKeyBackend.prototype, 'lookupByBearer').mockImplementation(() => {
      throw new Error('synthetic lookup failure');
    });

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': VALID_CN_BEARER },
    });

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'error' });
  });

  it('a thrown error in delegated_keys lookup logs error and does not block the request', async () => {
    testEnv.ROTATION_SHADOW_CHECK_ENABLED = 'true';
    testEnv.API_KEYS = '';

    // Sabotage the DB prepared statement execution.
    const db = getDb();
    const realPrepare = db.prepare.bind(db);
    (db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      const stmt = realPrepare(sql);
      if (/delegated_keys/.test(sql)) {
        return {
          ...stmt,
          get: () => { throw new Error('synthetic-db-failure'); },
        } as unknown as typeof stmt;
      }
      return stmt;
    }) as typeof db.prepare;

    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': VALID_CN_BEARER },
    });

    // Restore before assertions so afterEach closeDb() works cleanly.
    (db as unknown as { prepare: typeof db.prepare }).prepare = realPrepare;

    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith({ shadowCheck: 'error' });
  });
});
