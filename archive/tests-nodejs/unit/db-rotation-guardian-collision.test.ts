import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDbForTests,
  closeDb,
  initDb,
} from '../../src/db/index';

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  closeDb();
});

describe('v200 guardian version collision fix', () => {
  it('guardian version collision scenario — v200 creates rotation tables when 1-196 pre-populated', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnet-guardian-collision-'));
    const dbPath = path.join(tmpDir, 'test.db');
    try {
      const raw = new Database(dbPath);
      raw.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const insert = raw.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      );
      const now = new Date().toISOString();
      const populate = raw.transaction(() => {
        for (let v = 1; v <= 196; v++) {
          insert.run(v, now);
        }
      });
      populate();
      raw.close();

      const db = initDb({ path: dbPath });

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_key_rotation_credentials', 'api_key_rotation_identities', 'api_key_rotation_adoption') ORDER BY name",
        )
        .all() as { name: string }[];
      expect(tables.map((t) => t.name)).toEqual([
        'api_key_rotation_adoption',
        'api_key_rotation_credentials',
        'api_key_rotation_identities',
      ]);

      const v200 = db
        .prepare('SELECT version FROM schema_migrations WHERE version = 200')
        .get() as { version: number } | undefined;
      expect(v200?.version).toBe(200);
    } finally {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('v200 is a no-op on fresh DB — rotation tables already exist from v1/v2', () => {
    const db = initDb({ path: ':memory:' });

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_key_rotation_credentials', 'api_key_rotation_identities', 'api_key_rotation_adoption') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      'api_key_rotation_adoption',
      'api_key_rotation_credentials',
      'api_key_rotation_identities',
    ]);

    const versions = db
      .prepare('SELECT version FROM schema_migrations WHERE version IN (1, 200) ORDER BY version')
      .all() as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual([1, 200]);
  });
});
