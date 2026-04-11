/**
 * HTTP-level integration tests — rotation shadow-check wired through
 * `checkApiKey` middleware.
 *
 * Unit tests in `api-key-rotation-adoption.test.ts` already cover the core
 * `adoptApiKey` / `shadowCheckApiKey` semantics in isolation. This file
 * closes the remaining gap: a real HTTP request with a real `cn-...` bearer
 * goes through the real auth middleware (via `createTestApp`) and the
 * shadow-check path fires end-to-end.
 *
 * These are the tests that would have caught a broken import, a missing
 * try/catch, or a wiring bug in `src/middleware/auth.ts` that no amount of
 * unit testing on `rotation-adoption.ts` can detect.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  createTestApp,
  callEndpoint,
  mockX402Call,
  mockBirthCert,
  mockX402Throw,
  validApiKey,
} from './helpers/integration';

import { initDb } from '../../src/db/index';
import {
  _resetRotationStackForTests,
  adoptApiKey,
  shadowCheckCounters,
} from '../../src/core/rotation-adoption';

let app: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  initDb();
  app = await createTestApp();
});

beforeEach(() => {
  const db = getTestDb();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM api_key_rotation_adoptions').run();
  db.prepare('DELETE FROM api_key_rotation_credentials').run();
  db.prepare('DELETE FROM api_key_rotation_identities').run();
  _resetRotationStackForTests();
  shadowCheckCounters.notAdopted = 0;
  shadowCheckCounters.agree = 0;
  shadowCheckCounters.disagreeMissing = 0;
  shadowCheckCounters.disagreeMismatch = 0;
  mockX402Call({ price: 42, symbol: 'SOL' });
  mockBirthCert(null);
  mockX402Throw(null);
});

describe('rotation shadow-check is wired into checkApiKey middleware', () => {
  it('increments notAdopted for a live request using an unadopted key', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });

    // Legacy path authenticates the request; shadow-check observes that
    // no adoption row exists and bumps the notAdopted counter.
    expect(res.status).toBe(200);
    expect(shadowCheckCounters.notAdopted).toBe(1);
    expect(shadowCheckCounters.agree).toBe(0);
    expect(shadowCheckCounters.disagreeMissing).toBe(0);
    expect(shadowCheckCounters.disagreeMismatch).toBe(0);
  });

  it('increments agree for a live request using an adopted key', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    await adoptApiKey(key);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });

    expect(res.status).toBe(200);
    expect(shadowCheckCounters.agree).toBe(1);
    expect(shadowCheckCounters.notAdopted).toBe(0);
    expect(shadowCheckCounters.disagreeMissing).toBe(0);
    expect(shadowCheckCounters.disagreeMismatch).toBe(0);
  });

  it('increments disagreeMissing when the rotation credential has been wiped out from under an adopted key', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    await adoptApiKey(key);

    // Simulate the rotation backend losing the credential row while the
    // adoption pointer remains. The legacy path still wins, so the request
    // should succeed — but the shadow check must flag the divergence.
    getTestDb()
      .prepare('DELETE FROM api_key_rotation_credentials WHERE credential_id = ?')
      .run(key);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });

    expect(res.status).toBe(200);
    expect(shadowCheckCounters.disagreeMissing).toBe(1);
    expect(shadowCheckCounters.agree).toBe(0);
  });

  it('multiple sequential requests each fire the shadow check exactly once', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    await adoptApiKey(key);

    for (let i = 0; i < 3; i++) {
      const res = await callEndpoint(app, 'claw-token-price', {
        apiKey: key,
        params: { mintAddress: 'So11111111111111111111111111111111111111112' },
      });
      expect(res.status).toBe(200);
    }

    expect(shadowCheckCounters.agree).toBe(3);
  });

  it('legacy auth still wins when shadow-check would disagree (Phase 1 invariant)', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    await adoptApiKey(key);

    // Force a mismatch: wipe the rotation credential so shadow-check sees
    // disagree_missing. The request must still succeed — Phase 1 says
    // legacy wins regardless of what the rotation backend thinks.
    getTestDb()
      .prepare('DELETE FROM api_key_rotation_credentials WHERE credential_id = ?')
      .run(key);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });

    expect(res.status).toBe(200);
    expect(shadowCheckCounters.disagreeMissing).toBe(1);
  });
});
