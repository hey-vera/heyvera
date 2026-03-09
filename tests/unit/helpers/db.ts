/**
 * Test DB helper — creates an in-memory SQLite instance
 * and mocks the better-sqlite3 constructor so all src/db/index
 * calls land on the same in-memory DB.
 *
 * Usage (at top of every test file, before any src import):
 *   import { setupTestDb, getTestDb } from './helpers/db';
 *   setupTestDb();
 *
 * HOW IT WORKS
 * vi.mock() is hoisted above all imports by vitest's transform.
 * The factory uses importOriginal() to grab the real Database class,
 * creates one shared in-memory instance (_db), and returns a mock
 * constructor that always returns that instance.
 * setupTestDb() is intentionally a no-op — the mock factory runs
 * automatically. Call it in test files to make the setup intent explicit.
 */
import { vi } from 'vitest';
import type Database from 'better-sqlite3';

let _db: InstanceType<typeof Database> | null = null;

// Hoisted by vitest — runs before any imports in the test file.
vi.mock('better-sqlite3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('better-sqlite3')>();
  _db = new actual.default(':memory:');
  // Must use a regular function (not arrow) so it can be called with `new`
  // eslint-disable-next-line prefer-arrow-callback
  return { default: vi.fn(function DatabaseMock() { return _db; }) };
});

/** Call at the top of every test file (signals intent; mock is already set). */
export function setupTestDb(): void {
  // intentionally empty — mock factory above handles DB creation
}

export function getTestDb(): InstanceType<typeof Database> {
  if (!_db) throw new Error('Test DB not initialised — ensure setupTestDb() is called');
  return _db;
}

/** Create a test API key row and return it */
export function seedApiKey(
  db: InstanceType<typeof Database>,
  opts: { key?: string; credits?: number; clerkUserId?: string } = {}
): { key: string; clerkUserId: string } {
  const key = opts.key ?? `cn-test-${Math.random().toString(36).slice(2)}`;
  const clerkUserId = opts.clerkUserId ?? `user_${Math.random().toString(36).slice(2)}`;
  const credits = opts.credits ?? 1000;
  db.prepare(
    `INSERT OR REPLACE INTO api_keys (key, email, clerk_user_id, credits, credits_used, active)
     VALUES (?, ?, ?, ?, 0, 1)`
  ).run(key, `${key}@test.local`, clerkUserId, credits);
  return { key, clerkUserId };
}
