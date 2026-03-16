import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';
import { round6 } from '../core/credits';

// ─── Escrow ───────────────────────────────────────────────────────────────────

export type EscrowState =
  | 'CREATED' | 'FUNDED' | 'WORK_IN_PROGRESS'
  | 'COMPLETED' | 'DISPUTED' | 'RESOLVED' | 'REFUNDED';

export interface Escrow {
  id: string;
  hirer_id: string;
  worker_id: string;
  amount_credits: number;
  state: EscrowState;
  created_at: string;
  deadline: string | null;
  completed_at: string | null;
  metadata_json: string | null;
}

const ALLOWED_TRANSITIONS: Record<EscrowState, EscrowState[]> = {
  CREATED:          ['FUNDED'],
  FUNDED:           ['WORK_IN_PROGRESS', 'REFUNDED'],
  WORK_IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED:        [],
  DISPUTED:         ['RESOLVED'],
  RESOLVED:         [],
  REFUNDED:         [],
};

export function canTransition(from: EscrowState, to: EscrowState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createEscrow(params: {
  id: string;
  hirerId: string;
  workerId: string;
  amountCredits: number;
  deadline?: string;
  metadata?: Record<string, unknown>;
}): void {
  getDb()
    .prepare(`INSERT INTO escrows (id, hirer_id, worker_id, amount_credits, deadline, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      params.id, params.hirerId, params.workerId, params.amountCredits,
      params.deadline ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );
}

export function getEscrow(id: string): Escrow | undefined {
  return getDb().prepare('SELECT * FROM escrows WHERE id = ?').get(id) as Escrow | undefined;
}

export function listEscrowsForUser(clerkUserId: string, limit = 50, offset = 0): Escrow[] {
  return getDb()
    .prepare('SELECT * FROM escrows WHERE hirer_id = ? OR worker_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(clerkUserId, clerkUserId, limit, offset) as Escrow[];
}

/** Transition escrow state. Returns false if transition is not allowed. */
export function transitionEscrow(id: string, to: EscrowState, completedAt?: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT state FROM escrows WHERE id = ?').get(id) as { state: EscrowState } | undefined;
    if (!escrow || !canTransition(escrow.state, to)) return false;
    db.prepare(`UPDATE escrows SET state = ?, completed_at = ? WHERE id = ?`)
      .run(to, completedAt ?? null, id);
    return true;
  })();
}

/** Fund escrow: deduct credits from hirer atomically with state transition. */
export function fundEscrow(escrowId: string, hirerId: string): { ok: boolean; error?: string } {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
    if (!escrow) return { ok: false, error: 'Escrow not found' };
    if (escrow.hirer_id !== hirerId) return { ok: false, error: 'Not the hirer' };
    if (!canTransition(escrow.state, 'FUNDED')) return { ok: false, error: `Cannot fund from state ${escrow.state}` };

    const result = db.prepare(
      `UPDATE api_keys SET credits = credits - ? WHERE clerk_user_id = ? AND credits >= ? AND active = 1`
    ).run(escrow.amount_credits, hirerId, escrow.amount_credits);
    if (result.changes === 0) return { ok: false, error: 'Insufficient credits' };

    db.prepare(`UPDATE escrows SET state = 'FUNDED' WHERE id = ?`).run(escrowId);
    logAudit({ entityType: 'escrow', entityId: escrowId, action: 'ESCROW_FUNDED', actorId: hirerId, data: { amount: escrow.amount_credits } });
    return { ok: true };
  })();
}

/** Release escrow: credit worker atomically with state transition. */
export function releaseEscrow(escrowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'COMPLETED')) throw new Error(`Cannot release from state ${escrow.state}`);

      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ?`)
        .run(escrow.amount_credits, escrow.worker_id);
      if (result.changes === 0) throw new Error('Worker has no API key — credits cannot be disbursed');
      db.prepare(`UPDATE escrows SET state = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
      logAudit({ entityType: 'escrow', entityId: escrowId, action: 'ESCROW_RELEASED', data: { amount: escrow.amount_credits, workerId: escrow.worker_id } });
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/** Refund escrow to hirer (timeout / cancellation). */
export function refundEscrow(escrowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'REFUNDED')) throw new Error(`Cannot refund from state ${escrow.state}`);

      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ?`)
        .run(escrow.amount_credits, escrow.hirer_id);
      if (result.changes === 0) throw new Error('Hirer has no API key — credits cannot be refunded');
      db.prepare(`UPDATE escrows SET state = 'REFUNDED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
      logAudit({ entityType: 'escrow', entityId: escrowId, action: 'ESCROW_REFUNDED', data: { amount: escrow.amount_credits, hirerId: escrow.hirer_id } });
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/** Admin resolve: split credits between hirer and worker. */
export function resolveEscrow(escrowId: string, workerPct: number): { ok: boolean; error?: string } {
  const db = getDb();
  const pct = Math.max(0, Math.min(100, workerPct));
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'RESOLVED')) throw new Error(`Cannot resolve from state ${escrow.state}`);

      const workerShare = round6(escrow.amount_credits * pct / 100);
      const hirerShare = round6(escrow.amount_credits - workerShare);
      // Any sub-credit remainder goes to treasury to ensure total disbursed === amount_credits
      const remainder = round6(escrow.amount_credits - workerShare - hirerShare);
      if (workerShare > 0) {
        const r = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ?`)
          .run(workerShare, escrow.worker_id);
        if (r.changes === 0) throw new Error('Worker has no API key');
      }
      if (hirerShare > 0) {
        const r = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ?`)
          .run(hirerShare, escrow.hirer_id);
        if (r.changes === 0) throw new Error('Hirer has no API key');
      }
      if (remainder > 0) {
        db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = 'clawhub-treasury'`)
          .run(remainder);
      }
      db.prepare(`UPDATE escrows SET state = 'RESOLVED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
      logAudit({ entityType: 'escrow', entityId: escrowId, action: 'ESCROW_RESOLVED', data: { workerPct: pct, workerShare, hirerShare, remainder } });
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/** Find expired FUNDED/WORK_IN_PROGRESS escrows past their deadline. */
export function getExpiredEscrows(): Escrow[] {
  return getDb()
    .prepare(`SELECT * FROM escrows WHERE deadline IS NOT NULL AND deadline < datetime('now')
              AND state IN ('FUNDED', 'WORK_IN_PROGRESS')`)
    .all() as Escrow[];
}
