/**
 * Database barrel — the single import point for db helpers.
 *
 * Per `AGENTS.md` §"Critical Gotchas": callers must import database
 * helpers from `src/db/index.ts`, never reach into `connection.ts`
 * directly. Keeping a single barrel lets future refactors (e.g.
 * splitting connection from query helpers, adding a per-domain
 * accessor layer) land without rewriting every call site.
 */
import { getDb, logAudit } from './connection';

export {
  _resetDbForTests,
  closeDb,
  getDb,
  initDb,
  logAudit,
  type InitDbOptions,
} from './connection';

export function getApiKeyByClerkId(clerkUserId: string): {
  key: string; email: string; credits: number; amount_paid: number;
} | undefined {
  return getDb()
    .prepare('SELECT key, email, credits, amount_paid FROM api_keys WHERE clerk_user_id = ? AND active = 1')
    .get(clerkUserId) as { key: string; email: string; credits: number; amount_paid: number } | undefined;
}

export function createApiKeyForClerk(opts: {
  key: string;
  clerkUserId: string;
  email: string;
  credits: number;
  solanaSignature: string;
  amountPaid: number;
}): void {
  getDb().prepare(`
    INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, clerk_user_id, amount_paid)
    VALUES (?, ?, ?, 0, datetime('now'), ?, ?, ?)
  `).run(opts.key, opts.email, opts.credits, opts.solanaSignature, opts.clerkUserId, opts.amountPaid);
  logAudit({ entityType: 'api_key', entityId: opts.key, action: 'CREDIT_GRANT', actorId: opts.clerkUserId, data: { credits: opts.credits, amountPaid: opts.amountPaid, via: 'oauth' } });
}
