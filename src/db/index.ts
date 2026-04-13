/**
 * Database barrel — the single import point for db helpers.
 *
 * Per `AGENTS.md` §"Critical Gotchas": callers must import database
 * helpers from `src/db/index.ts`, never reach into `connection.ts`
 * directly. Keeping a single barrel lets future refactors (e.g.
 * splitting connection from query helpers, adding a per-domain
 * accessor layer) land without rewriting every call site.
 */
export {
  _resetDbForTests,
  closeDb,
  getDb,
  initDb,
  type InitDbOptions,
} from './connection';
