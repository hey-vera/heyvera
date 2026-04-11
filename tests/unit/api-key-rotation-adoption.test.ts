/**
 * Unit tests — shadow-adoption Phase 1 flow.
 *
 * Covers `adoptApiKey`, `shadowCheckApiKey`, and the idempotence / shadow
 * counter behaviour that the live admin route + middleware depend on.
 * Does not go through HTTP — calls the core module directly so the
 * test stays focused on the adoption semantics.
 */
import crypto from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setupTestDb, getTestDb } from './helpers/db';

setupTestDb();

import { initDb } from '../../src/db/index';
import {
  _resetRotationStackForTests,
  adoptApiKey,
  getAdoption,
  shadowCheckApiKey,
  shadowCheckCounters,
} from '../../src/core/rotation-adoption';

function randomCnKey(): string {
  return `cn-${crypto.randomBytes(24).toString('hex')}`;
}

function seedLegacyKey(key: string): void {
  getTestDb()
    .prepare(
      `INSERT INTO api_keys (key, email, clerk_user_id, credits, credits_used, active)
       VALUES (?, ?, ?, 1000, 0, 1)`,
    )
    .run(key, `${key.slice(0, 12)}@test.local`, `user_${key.slice(3, 11)}`);
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  const db = getTestDb();
  db.prepare('DELETE FROM api_key_rotation_adoptions').run();
  db.prepare('DELETE FROM api_key_rotation_credentials').run();
  db.prepare('DELETE FROM api_key_rotation_identities').run();
  db.prepare('DELETE FROM api_keys').run();
  _resetRotationStackForTests();
  shadowCheckCounters.notAdopted = 0;
  shadowCheckCounters.agree = 0;
  shadowCheckCounters.disagreeMissing = 0;
  shadowCheckCounters.disagreeMismatch = 0;
});

describe('shadow-adoption Phase 1', () => {
  it('adopts an existing cn- key and reuses its bearer as the credentialId', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);

    const record = await adoptApiKey(key);
    expect(record.apiKey).toBe(key);
    expect(record.identityId).toMatch(/^id-cn-[a-f0-9]{32}$/);
    expect(record.authoritative).toBe(false);

    const credRow = getTestDb()
      .prepare(
        'SELECT identity_id FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(key) as { identity_id: string } | undefined;
    expect(credRow?.identity_id).toBe(record.identityId);

    const identRow = getTestDb()
      .prepare(
        'SELECT current_credential_id FROM api_key_rotation_identities WHERE identity_id = ?',
      )
      .get(record.identityId) as { current_credential_id: string } | undefined;
    expect(identRow?.current_credential_id).toBe(key);
  });

  it('is idempotent — re-adopting returns the same record without duplicate rows', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);

    const first = await adoptApiKey(key);
    const second = await adoptApiKey(key);
    expect(second.identityId).toBe(first.identityId);
    expect(second.adoptedAt).toBe(first.adoptedAt);

    const count = getTestDb()
      .prepare('SELECT COUNT(*) as c FROM api_key_rotation_adoptions')
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('derives identityId deterministically from the key', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);
    const first = await adoptApiKey(key);

    // Re-run the full flow against a fresh stack: same key → same identity.
    _resetRotationStackForTests();
    getTestDb().prepare('DELETE FROM api_key_rotation_adoptions').run();
    getTestDb().prepare('DELETE FROM api_key_rotation_credentials').run();
    getTestDb().prepare('DELETE FROM api_key_rotation_identities').run();

    const second = await adoptApiKey(key);
    expect(second.identityId).toBe(first.identityId);
  });

  it('rejects malformed bearers', async () => {
    await expect(adoptApiKey('not-a-real-key')).rejects.toThrow(/malformed/);
  });

  it('getAdoption returns null for unknown keys', () => {
    expect(getAdoption(randomCnKey())).toBeNull();
  });
});

describe('shadow-adoption shadow check', () => {
  it('reports not_adopted for keys that were never adopted', () => {
    const key = randomCnKey();
    const result = shadowCheckApiKey(key, Date.now());
    expect(result.outcome).toBe('not_adopted');
    expect(shadowCheckCounters.notAdopted).toBe(1);
    expect(shadowCheckCounters.agree).toBe(0);
  });

  it('reports agree for an adopted key resolved through the backend', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);
    const record = await adoptApiKey(key);

    const result = shadowCheckApiKey(key, Date.now());
    expect(result.outcome).toBe('agree');
    if (result.outcome === 'agree') {
      expect(result.identityId).toBe(record.identityId);
    }
    expect(shadowCheckCounters.agree).toBe(1);
  });

  it('reports disagree_missing when the adoption row exists but the credential row was wiped', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);
    await adoptApiKey(key);

    getTestDb()
      .prepare('DELETE FROM api_key_rotation_credentials WHERE credential_id = ?')
      .run(key);

    const result = shadowCheckApiKey(key, Date.now());
    expect(result.outcome).toBe('disagree_missing');
    expect(shadowCheckCounters.disagreeMissing).toBe(1);
  });

  it('reports disagree_missing when the credential has expired', async () => {
    const key = randomCnKey();
    seedLegacyKey(key);
    await adoptApiKey(key);

    // Jump past the 10-minute default TTL (class A).
    const future = Date.now() + 11 * 60 * 1000;
    const result = shadowCheckApiKey(key, future);
    expect(result.outcome).toBe('disagree_missing');
  });

  it('never throws on unknown keys so the middleware wrapper is unnecessary in the happy path', () => {
    expect(() => shadowCheckApiKey(randomCnKey(), Date.now())).not.toThrow();
  });
});
