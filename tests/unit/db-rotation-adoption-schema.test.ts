/**
 * Unit tests — `api_key_rotation_adoption` schema (migration v2).
 *
 * Covers the shape of the Gate 7.2 adoption mapping table. Like the
 * v1 schema test, these exist so any accidental change to the DDL
 * shows up as a failing test here instead of as a runtime error in a
 * later PR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('db rotation adoption schema (migration v2)', () => {
  it('api_key_rotation_adoption has exactly three columns', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_adoption)')
      .all() as PragmaColumn[];
    // G7.2 explicitly ships a three-column table. Any addition
    // (source, authoritative, credential_id) is out of Gate 7 scope
    // and must land in its own migration.
    expect(cols.map((c) => c.name).sort()).toEqual([
      'adopted_at',
      'bearer',
      'identity_id',
    ]);
  });

  it('bearer is TEXT PRIMARY KEY', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_adoption)')
      .all() as PragmaColumn[];
    const bearer = cols.find((c) => c.name === 'bearer');
    expect(bearer?.type).toBe('TEXT');
    expect(bearer?.pk).toBe(1);
    expect(bearer?.notnull).toBe(1);
  });

  it('identity_id is TEXT NOT NULL', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_adoption)')
      .all() as PragmaColumn[];
    const col = cols.find((c) => c.name === 'identity_id');
    expect(col?.type).toBe('TEXT');
    expect(col?.notnull).toBe(1);
  });

  it('adopted_at is INTEGER NOT NULL', () => {
    const db = initDb({ path: ':memory:' });
    const cols = db
      .prepare('PRAGMA table_info(api_key_rotation_adoption)')
      .all() as PragmaColumn[];
    const col = cols.find((c) => c.name === 'adopted_at');
    expect(col?.type).toBe('INTEGER');
    expect(col?.notnull).toBe(1);
  });

  it('idx_akra_identity index exists on api_key_rotation_adoption(identity_id)', () => {
    const db = initDb({ path: ':memory:' });
    const indexList = db
      .prepare('PRAGMA index_list(api_key_rotation_adoption)')
      .all() as { name: string }[];
    const names = new Set(indexList.map((i) => i.name));
    expect(names.has('idx_akra_identity')).toBe(true);

    const indexInfo = db
      .prepare("PRAGMA index_info('idx_akra_identity')")
      .all() as { name: string }[];
    expect(indexInfo.map((c) => c.name)).toEqual(['identity_id']);
  });

  it('row round-trips through insert and select', () => {
    const db = initDb({ path: ':memory:' });
    db.prepare(
      `INSERT INTO api_key_rotation_adoption (bearer, identity_id, adopted_at)
       VALUES (?, ?, ?)`,
    ).run('cn-' + 'a'.repeat(48), 'id-roundtrip', 1_700_000_000_000);

    const row = db
      .prepare(
        'SELECT bearer, identity_id, adopted_at FROM api_key_rotation_adoption WHERE bearer = ?',
      )
      .get('cn-' + 'a'.repeat(48)) as {
      bearer: string;
      identity_id: string;
      adopted_at: number;
    };
    expect(row.bearer).toBe('cn-' + 'a'.repeat(48));
    expect(row.identity_id).toBe('id-roundtrip');
    expect(row.adopted_at).toBe(1_700_000_000_000);
  });

  it('duplicate bearer insert is refused (PK constraint)', () => {
    const db = initDb({ path: ':memory:' });
    db.prepare(
      `INSERT INTO api_key_rotation_adoption (bearer, identity_id, adopted_at)
       VALUES (?, ?, ?)`,
    ).run('cn-' + 'b'.repeat(48), 'id-dup', 1_700_000_000_000);

    expect(() =>
      db
        .prepare(
          `INSERT INTO api_key_rotation_adoption (bearer, identity_id, adopted_at)
           VALUES (?, ?, ?)`,
        )
        .run('cn-' + 'b'.repeat(48), 'id-dup', 1_700_000_000_000),
    ).toThrow(/UNIQUE|PRIMARY KEY/i);
  });

  it('NOT NULL enforcement: insert without identity_id throws', () => {
    const db = initDb({ path: ':memory:' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_key_rotation_adoption (bearer, adopted_at)
           VALUES (?, ?)`,
        )
        .run('cn-' + 'c'.repeat(48), 1_700_000_000_000),
    ).toThrow(/NOT NULL/i);
  });

  it('NOT NULL enforcement: insert without adopted_at throws', () => {
    const db = initDb({ path: ':memory:' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO api_key_rotation_adoption (bearer, identity_id)
           VALUES (?, ?)`,
        )
        .run('cn-' + 'd'.repeat(48), 'id-noTs'),
    ).toThrow(/NOT NULL/i);
  });

  it('migration v2 is recorded in schema_migrations', () => {
    const db = initDb({ path: ':memory:' });
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[];
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 6, 197]);
  });

  it('migration v2 is idempotent across simulated process restarts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnet-adoption-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    try {
      initDb({ path: dbPath });
      closeDb();
      _resetDbForTests();

      const second = initDb({ path: dbPath });
      const versions = second
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as { version: number }[];
      expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 6, 197]);

      // Table still present and empty.
      const count = (
        second
          .prepare('SELECT COUNT(*) AS n FROM api_key_rotation_adoption')
          .get() as { n: number }
      ).n;
      expect(count).toBe(0);
    } finally {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
