/**
 * Unit tests — SQLite connection scaffold.
 *
 * Covers the contract the module promises in this PR:
 *
 *   1. `initDb({ path: ':memory:' })` opens a handle and creates the
 *      `schema_migrations` bootstrap table.
 *   2. Init is idempotent: a second call with no intervening close
 *      returns the same handle (no duplicate bootstrap, no pragma reset).
 *   3. `getDb()` before `initDb()` throws rather than silently opening
 *      a lazy handle that would bypass the startup lifecycle.
 *   4. `closeDb()` releases the handle; a subsequent `getDb()` throws
 *      with the same "call initDb first" contract.
 *   5. Standard pragmas are set: `foreign_keys=ON` (default is OFF),
 *      and `busy_timeout=5000`. Journal mode is NOT checked here
 *      because `:memory:` databases always report `memory` regardless
 *      of the WAL pragma — WAL is a file-backed mode.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDbForTests,
  closeDb,
  getDb,
  initDb,
} from '../../src/db/index';

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  closeDb();
});

describe('db/connection', () => {
  it('initDb opens a handle and creates schema_migrations', () => {
    const db = initDb({ path: ':memory:' });
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('schema_migrations');
  });

  it('is idempotent — a second initDb returns the same handle', () => {
    const first = initDb({ path: ':memory:' });
    const second = initDb({ path: ':memory:' });
    expect(second).toBe(first);
  });

  it('getDb before initDb throws', () => {
    expect(() => getDb()).toThrow(/initDb/);
  });

  it('closeDb releases the handle; subsequent getDb throws', () => {
    initDb({ path: ':memory:' });
    closeDb();
    expect(() => getDb()).toThrow(/initDb/);
  });

  it('sets foreign_keys=ON and busy_timeout=5000', () => {
    const db = initDb({ path: ':memory:' });
    const fk = db.pragma('foreign_keys', { simple: true });
    const busy = db.pragma('busy_timeout', { simple: true });
    expect(fk).toBe(1);
    expect(busy).toBe(5000);
  });

  it('records v1 rotation-schema migration in schema_migrations', () => {
    const db = initDb({ path: ':memory:' });
    const row = db
      .prepare('SELECT version, applied_at FROM schema_migrations WHERE version = 1')
      .get() as { version: number; applied_at: string } | undefined;
    expect(row?.version).toBe(1);
    expect(typeof row?.applied_at).toBe('string');
  });

  it('records v2 adoption-schema migration in schema_migrations', () => {
    const db = initDb({ path: ':memory:' });
    const row = db
      .prepare('SELECT version, applied_at FROM schema_migrations WHERE version = 2')
      .get() as { version: number; applied_at: string } | undefined;
    expect(row?.version).toBe(2);
    expect(typeof row?.applied_at).toBe('string');
  });

  it('migration is idempotent across simulated process restarts', () => {
    // Use a real on-disk path so state persists between initDb calls.
    // :memory: can't exercise this because each handle gets a fresh db.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnet-db-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    try {
      const first = initDb({ path: dbPath });
      const firstRows = first
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as { version: number }[];
      expect(firstRows.map((r) => r.version)).toEqual([1, 2, 3, 4, 197, 198, 199]);

      // Simulate a process restart: close the handle, reset the module
      // cache, and re-init against the same file.
      closeDb();
      _resetDbForTests();

      const second = initDb({ path: dbPath });
      const secondRows = second
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as { version: number }[];
      // Still exactly five rows — the migrations are skipped because
      // versions 1–5 are already applied.
      expect(secondRows.map((r) => r.version)).toEqual([1, 2, 3, 4, 197, 198, 199]);
    } finally {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('aligns legacy guardian-vps delegated_keys schema before v198 runs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnet-db-legacy-'));
    const dbPath = path.join(tmpDir, 'legacy.db');
    try {
      // Phase 1: build a database that looks like production (guardian-vps
      // migrations 1–196 applied, legacy delegated_keys with child_key PK).
      const raw = new Database(dbPath);

      raw.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const ins = raw.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      );
      for (let v = 1; v <= 196; v++) {
        ins.run(v, '2025-01-01T00:00:00.000Z');
      }

      raw.exec(`
        CREATE TABLE api_keys (
          key TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          credits INTEGER NOT NULL DEFAULT 0,
          credits_used INTEGER NOT NULL DEFAULT 0,
          stripe_session_id TEXT UNIQUE,
          amount_paid REAL NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          clerk_user_id TEXT
        )
      `);
      raw.exec(`
        CREATE TABLE delegated_keys (
          child_key TEXT PRIMARY KEY,
          parent_key TEXT NOT NULL,
          label TEXT,
          spend_limit REAL NOT NULL,
          spent REAL NOT NULL DEFAULT 0,
          expires_at TEXT,
          permissions_json TEXT NOT NULL DEFAULT '["invoke","query"]',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          depth INTEGER NOT NULL DEFAULT 0,
          max_depth INTEGER NOT NULL DEFAULT 0,
          branch_spend_limit REAL,
          intent_declaration TEXT,
          scope_endpoints_glob TEXT,
          revoked_at TEXT
        )
      `);

      raw.exec(
        "INSERT INTO api_keys (key, email) VALUES ('cn-root', 'r@test.com')",
      );
      raw.exec(
        "INSERT INTO delegated_keys (child_key, parent_key, spend_limit) VALUES ('cn-child', 'cn-root', 100)",
      );
      raw.close();

      // Phase 2: initDb should align the legacy schema then apply v197+v198+v199.
      const db = initDb({ path: dbPath });

      const cols = (
        db.pragma('table_info(delegated_keys)') as Array<{ name: string }>
      ).map((c) => c.name);
      expect(cols).toContain('key');
      expect(cols).not.toContain('child_key');
      expect(cols).toContain('account_key');
      expect(cols).toContain('spend_cap_credits');
      expect(cols).toContain('spend_used_credits');
      expect(cols).toContain('scope_endpoints');
      expect(cols).not.toContain('scope_endpoints_glob');

      const row = db
        .prepare(
          'SELECT key, account_key, parent_key FROM delegated_keys WHERE key = ?',
        )
        .get('cn-child') as {
        key: string;
        account_key: string;
        parent_key: string;
      };
      expect(row.key).toBe('cn-child');
      expect(row.account_key).toBe('cn-root');
      expect(row.parent_key).toBe('cn-root');

      const versions = (
        db
          .prepare(
            'SELECT version FROM schema_migrations WHERE version >= 197 ORDER BY version',
          )
          .all() as { version: number }[]
      ).map((v) => v.version);
      expect(versions).toEqual([197, 198, 199]);

      const indexes = (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='delegated_keys'",
          )
          .all() as { name: string }[]
      ).map((i) => i.name);
      expect(indexes).toContain('idx_delegated_keys_account');
      expect(indexes).toContain('idx_delegated_keys_parent');
    } finally {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('alignment is a no-op on fresh databases', () => {
    const db = initDb({ path: ':memory:' });
    const cols = (
      db.pragma('table_info(delegated_keys)') as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain('key');
    expect(cols).toContain('account_key');
    expect(cols).not.toContain('child_key');
  });
});
