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
 * Empty in the db-scaffold PR. Each later PR that introduces a new
 * table appends one entry here with a monotonically-increasing
 * `version` and an idempotent `up` function.
 */
const MIGRATIONS: Migration[] = [];

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

  const insertApplied = handle.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
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
