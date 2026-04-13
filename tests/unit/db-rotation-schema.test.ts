/**
 * Unit tests — rotation schema (migration v1).
 *
 * Covers the shape of the two inert tables introduced by migration v1:
 * `api_key_rotation_credentials` and `api_key_rotation_identities`.
 * These tables are not read or written by any request-path code yet;
 * these tests exist so that later PRs wiring `ClawNetApiKeyBackend`
 * inherit a verified column layout and so any accidental change to
 * the migration DDL shows up as a failing test here instead of as a
 * runtime error weeks later.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';

type PragmaColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
};

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  closeDb();
});

describe('db rotation schema (migration v1)', () => {
  it('api_key_rotation_credentials has expected columns', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_credentials)')
      .all() as PragmaColumn[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.get('credential_id')?.pk).toBe(1);
    expect(byName.get('credential_id')?.type).toBe('TEXT');

    for (const required of [
      'identity_id',
      'algorithm_suite',
      'class',
      'public_key',
      'secret_key',
      'next_manifest_commitment',
    ]) {
      const col = byName.get(required);
      expect(col, `missing column ${required}`).toBeDefined();
      expect(col?.type).toBe('TEXT');
      expect(col?.notnull).toBe(1);
    }

    expect(byName.get('issued_at')?.type).toBe('INTEGER');
    expect(byName.get('issued_at')?.notnull).toBe(1);
    expect(byName.get('expires_at')?.type).toBe('INTEGER');
    expect(byName.get('expires_at')?.notnull).toBe(1);

    const revoked = byName.get('revoked');
    expect(revoked?.type).toBe('INTEGER');
    expect(revoked?.notnull).toBe(1);
    expect(String(revoked?.dflt_value)).toBe('0');
  });

  it('api_key_rotation_identities has expected columns', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_identities)')
      .all() as PragmaColumn[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.get('identity_id')?.pk).toBe(1);
    expect(byName.get('identity_id')?.type).toBe('TEXT');

    for (const required of [
      'current_credential_id',
      'next_public_key',
      'next_secret_key',
    ]) {
      const col = byName.get(required);
      expect(col, `missing column ${required}`).toBeDefined();
      expect(col?.type).toBe('TEXT');
      expect(col?.notnull).toBe(1);
    }

    expect(byName.get('ttl_ms')?.type).toBe('INTEGER');
    expect(byName.get('ttl_ms')?.notnull).toBe(1);
  });

  it('idx_akrc_identity index exists on api_key_rotation_credentials(identity_id)', () => {
    const db = initDb({ path: ':memory:' });
    const indexList = db
      .prepare('PRAGMA index_list(api_key_rotation_credentials)')
      .all() as { name: string }[];
    const names = new Set(indexList.map((i) => i.name));
    expect(names.has('idx_akrc_identity')).toBe(true);

    const indexInfo = db
      .prepare("PRAGMA index_info('idx_akrc_identity')")
      .all() as { name: string }[];
    expect(indexInfo.map((c) => c.name)).toEqual(['identity_id']);
  });

  it('credential row round-trips through insert and select', () => {
    const db = initDb({ path: ':memory:' });
    db.prepare(
      `INSERT INTO api_key_rotation_credentials
       (credential_id, identity_id, algorithm_suite, class, public_key, secret_key,
        next_manifest_commitment, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'cred-1',
      'id-1',
      'ed25519',
      'tier1',
      'pk-base64',
      'v1:sk-blob',
      'commit-hash',
      1_700_000_000_000,
      1_700_000_600_000,
    );

    const row = db
      .prepare(
        `SELECT credential_id, identity_id, algorithm_suite, class, public_key,
                secret_key, next_manifest_commitment, issued_at, expires_at, revoked
         FROM api_key_rotation_credentials WHERE credential_id = ?`,
      )
      .get('cred-1') as {
      credential_id: string;
      identity_id: string;
      algorithm_suite: string;
      class: string;
      public_key: string;
      secret_key: string;
      next_manifest_commitment: string;
      issued_at: number;
      expires_at: number;
      revoked: number;
    };

    expect(row.credential_id).toBe('cred-1');
    expect(row.identity_id).toBe('id-1');
    expect(row.algorithm_suite).toBe('ed25519');
    expect(row.class).toBe('tier1');
    expect(row.public_key).toBe('pk-base64');
    expect(row.secret_key).toBe('v1:sk-blob');
    expect(row.next_manifest_commitment).toBe('commit-hash');
    expect(row.issued_at).toBe(1_700_000_000_000);
    expect(row.expires_at).toBe(1_700_000_600_000);
    // default 0 applied when omitted
    expect(row.revoked).toBe(0);
  });

  it('NOT NULL enforcement: inserting a credential without secret_key throws', () => {
    const db = initDb({ path: ':memory:' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_key_rotation_credentials
           (credential_id, identity_id, algorithm_suite, class, public_key,
            next_manifest_commitment, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'cred-2',
          'id-2',
          'ed25519',
          'tier1',
          'pk',
          'commit',
          1_700_000_000_000,
          1_700_000_600_000,
        ),
    ).toThrow(/NOT NULL/i);
  });

  it('NOT NULL enforcement: inserting an identity without next_secret_key throws', () => {
    const db = initDb({ path: ':memory:' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_key_rotation_identities
           (identity_id, current_credential_id, next_public_key, ttl_ms)
           VALUES (?, ?, ?, ?)`,
        )
        .run('id-3', 'cred-3', 'pk-next', 60_000),
    ).toThrow(/NOT NULL/i);
  });
});
