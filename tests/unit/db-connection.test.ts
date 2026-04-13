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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDbForTests,
  closeDb,
  getDb,
  initDb,
} from '../../src/db/connection';

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
});
