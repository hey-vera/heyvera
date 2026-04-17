/**
 * SQLite connection scaffold — single shared `better-sqlite3` handle.
 *
 * Pure-infrastructure module: nothing in the request path uses this yet.
 * It exists so that upcoming work (rotation credential tables, receipt
 * log, etc.) can open a database via a single reviewed primitive with
 * consistent pragmas, a migration bootstrap table, and a lifecycle
 * (init on start, close on shutdown) wired into the server.
 *
 * Pragmas set at init:
 *
 *   - `journal_mode=WAL`      — concurrent reads during writes; standard
 *                               for a single-process writer on a VPS.
 *   - `foreign_keys=ON`       — enforce FK constraints (off by default
 *                               in SQLite, which would silently permit
 *                               orphaned rows).
 *   - `busy_timeout=5000`     — block up to 5s on a locked database
 *                               instead of failing immediately, which
 *                               covers the occasional WAL checkpoint.
 *
 * Migration bootstrap: a `schema_migrations(version INTEGER PRIMARY KEY,
 * applied_at TEXT NOT NULL)` table is created unconditionally. The
 * MIGRATIONS array is intentionally empty in this PR — real migrations
 * (rotation tables, etc.) land in later PRs, each one appending a new
 * entry whose `version` is monotonically increasing.
 *
 * Test path: `initDb({ path: ':memory:' })` skips the data-directory
 * creation so unit tests can exercise the scaffold without touching the
 * filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { env } from '../config/index';
import { logger } from '../utils/logger';

type DbHandle = Database.Database;

interface Migration {
  version: number;
  description: string;
  up: (db: DbHandle) => void;
}

/**
 * Registered schema migrations, applied in order.
 *
 * Each entry must be idempotent under `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` so that replaying the migration on a
 * database that already has the table is a no-op. Version numbers
 * are monotonically increasing; never re-use or re-order a version
 * once it has been merged to main.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'api_key_rotation credentials + identities',
    up: (db) => {
      // Durable half of the upcoming ClawNetApiKeyBackend:
      //
      //   api_key_rotation_credentials — every minted credential, active
      //   or revoked. The controller's verify-before-revoke keeps stale
      //   rows around until the next identity rotation drops them.
      //
      //   api_key_rotation_identities  — per-identity pointer tracking
      //   the current credential and the pre-committed next keypair.
      //
      // Both tables are INERT in this PR: no request-path code reads or
      // writes them yet. The backend wiring, admin mint endpoint, and
      // shadow-check lookup land in later PRs (#5/#6/#7).
      //
      // Secret columns store either a plain base64 row (legacy/no KEK)
      // or a `v1:…` AES-256-GCM blob from `src/core/vault-crypto.ts`.
      // Both forms are transparently handled by `decryptSecret`.
      //
      // No foreign keys: `identity_id` is a free-form string, and the
      // identities table is not populated from any cross-table source
      // that would meaningfully constrain it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_credentials (
          credential_id TEXT PRIMARY KEY,
          identity_id TEXT NOT NULL,
          algorithm_suite TEXT NOT NULL,
          class TEXT NOT NULL,
          public_key TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          next_manifest_commitment TEXT NOT NULL,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_akrc_identity
          ON api_key_rotation_credentials(identity_id);
        CREATE TABLE IF NOT EXISTS api_key_rotation_identities (
          identity_id TEXT PRIMARY KEY,
          current_credential_id TEXT NOT NULL,
          next_public_key TEXT NOT NULL,
          next_secret_key TEXT NOT NULL,
          ttl_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    description: 'api_key_rotation_adoption mapping (G7.2)',
    up: (db) => {
      // Storage-only mapping for the Gate 7.2 adoption primitive. Each
      // row claims a `cn-[a-f0-9]{48}` legacy bearer as a rotation
      // credential: the `bearer` column equals the corresponding
      // `api_key_rotation_credentials.credential_id` by construction,
      // because the adoption path writes both rows in a single sync
      // transaction with `credential_id = bearer`.
      //
      // Three columns only. No `source`, no `authoritative`, no FK.
      // Rationale:
      //   - `source` / `authoritative` belong to the post-Gate-7
      //     cutover and would pre-commit schema decisions that that
      //     work deserves to make in its own PR.
      //   - No FK because v1 skips FKs and v2 stays consistent.
      //
      // Rollback (documented-only, no down hook):
      //   DROP INDEX idx_akra_identity;
      //   DROP TABLE api_key_rotation_adoption;
      //
      // This migration is additive and cannot corrupt v1 state.
      // SQLite quirk: `bearer TEXT PRIMARY KEY` alone would permit NULL
      // in the PK column (historical behavior preserved for backwards
      // compatibility; see https://sqlite.org/lang_createtable.html#the_primary_key).
      // Declare `NOT NULL` explicitly so `PRAGMA table_info` reports
      // notnull=1 and a NULL insert is refused at the engine level.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_adoption (
          bearer TEXT PRIMARY KEY NOT NULL,
          identity_id TEXT NOT NULL,
          adopted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_akra_identity
          ON api_key_rotation_adoption(identity_id);
      `);
    },
  },
  {
    version: 3,
    description: 'oauth_codes + audit_log — Sign in with ClawNet foundation tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_codes (
          code TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          api_key TEXT NOT NULL,
          app TEXT NOT NULL,
          email TEXT DEFAULT '',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_id TEXT,
          data_json TEXT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity
          ON audit_log(entity_type, entity_id);
      `);
    },
  },
  {
    version: 4,
    description: 'api_keys — core account table (no-op on live DB, migration debt repair)',
    up: (db) => {
      // CREATE TABLE IF NOT EXISTS is a safe no-op on the live database where
      // this table already exists (created by the guardian-vps migration lineage).
      // On a fresh database (CI, local dev, new VPS) this creates the table so
      // that GET /v1/auth/me and the OAuth auto-create path work without external
      // SQL setup. Columns and defaults exactly match the guardian-vps production
      // schema as of 2026-04.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
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
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_clerk
          ON api_keys(clerk_user_id);
      `);
    },
  },
];

let db: DbHandle | null = null;

export interface InitDbOptions {
  /**
   * Override the database path. Defaults to `env.DB_PATH`.
   * Pass `':memory:'` in tests to skip filesystem IO.
   */
  path?: string;
}

/**
 * Open the database handle, set pragmas, and run any pending
 * migrations. Idempotent: calling twice with no intervening `closeDb`
 * returns the existing handle.
 */
export function initDb(options: InitDbOptions = {}): DbHandle {
  if (db) return db;

  const dbPath = options.path ?? env.DB_PATH;

  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
  }

  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');

  handle.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set<number>(
    handle
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  // `OR IGNORE` on the schema_migrations insert makes the migration
  // step race-tolerant: if two initializers somehow hit the same
  // on-disk database before either has committed (not a supported
  // operating mode today — the orchestrator runs as a single Node
  // process — but also not guaranteed by anything architectural), the
  // second writer's `CREATE TABLE IF NOT EXISTS` is already a no-op,
  // and this insert silently no-ops instead of tripping the PRIMARY
  // KEY constraint and rolling the whole transaction back.
  const insertApplied = handle.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    const runMigration = handle.transaction(() => {
      migration.up(handle);
      insertApplied.run(migration.version, new Date().toISOString());
    });
    runMigration();
    logger.info(
      { version: migration.version, description: migration.description },
      'db: migration applied',
    );
  }

  db = handle;
  logger.info({ path: dbPath }, 'db: initialized');
  return db;
}

/**
 * Return the shared database handle. Throws if `initDb` has not been
 * called yet — callers should never lazily open the database on first
 * query, because that would bypass the startup lifecycle and hide
 * migration failures behind the first request.
 */
export function getDb(): DbHandle {
  if (!db) {
    throw new Error('db: getDb() called before initDb()');
  }
  return db;
}

/**
 * Close the database handle. Safe to call multiple times; a no-op if
 * the handle is already closed. Invoked from the graceful-shutdown
 * hook so the WAL is checkpointed and the file handle released before
 * the process exits.
 */
export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
  }
}

/**
 * Test-only: drop the shared handle without closing it. Used by unit
 * tests that want to simulate a fresh process without tearing down an
 * in-memory database they still want to inspect via a separate handle.
 */
export function _resetDbForTests(): void {
  db = null;
}

/**
 * Append a row to audit_log — fire-and-forget, never throws.
 * Silently no-ops if the audit_log table doesn't exist (e.g. fresh dev DB).
 */
export function logAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nanoid(16),
        params.entityType,
        params.entityId,
        params.action,
        params.actorId ?? null,
        params.data ? JSON.stringify(params.data) : null,
      );
  } catch {
    // Never let audit failures crash the caller
  }
}
