import { nanoid } from 'nanoid';
import { getDb } from './connection';
import { logger } from '../utils/logger';

// ─── Governance ────────────────────────────────────────────────────────────────

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposed_by: string;
  status: 'OPEN' | 'CLOSED' | 'EXECUTED';
  votes_for: number;
  votes_against: number;
  created_at: string;
  closes_at: string;
  // v66: proposal bonds
  bond_credits: number;
  bond_released: number;
  // v67: quorum & governance execution
  quorum_pct: number;
  action_type: string | null;
  action_payload_json: string | null;
  executed_at: string | null;
  execution_result_json: string | null;
}

export function createProposal(params: {
  title: string;
  description: string;
  proposedBy: string;
  closeDays?: number;
  bondCredits?: number;
  quorumPct?: number;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
}): string {
  const id = nanoid(16);
  const days = Math.max(1, Math.min(90, Math.floor(params.closeDays ?? 7)));
  const bond = params.bondCredits ?? 0;

  const quorumPct = Math.max(0, Math.min(51, params.quorumPct ?? 0));
  const actionType = params.actionType ?? null;
  const actionPayload = params.actionPayload ? JSON.stringify(params.actionPayload) : null;

  if (bond > 0) {
    // Lock bond credits — deduct from balance, record bond amount on proposal
    const db = getDb();
    db.transaction(() => {
      const row = db.prepare('SELECT credits FROM api_keys WHERE key = ?').get(params.proposedBy) as { credits: number } | undefined;
      if (!row || row.credits < bond) throw new Error('Insufficient credits for proposal bond');
      db.prepare('UPDATE api_keys SET credits = credits - ? WHERE key = ?').run(bond, params.proposedBy);
      db.prepare(`
        INSERT INTO proposals (id, title, description, proposed_by, closes_at, bond_credits, quorum_pct, action_type, action_payload_json)
        VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'), ?, ?, ?, ?)
      `).run(id, params.title, params.description, params.proposedBy, days, bond, quorumPct, actionType, actionPayload);
    })();
  } else {
    getDb().prepare(`
      INSERT INTO proposals (id, title, description, proposed_by, closes_at, quorum_pct, action_type, action_payload_json)
      VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'), ?, ?, ?)
    `).run(id, params.title, params.description, params.proposedBy, days, quorumPct, actionType, actionPayload);
  }

  return id;
}

/**
 * Release bond credits back to the proposer when a proposal closes.
 * Called during auto-close or manual close. Idempotent — won't double-release.
 */
export function releaseBond(proposalId: string): void {
  const db = getDb();
  db.transaction(() => {
    const proposal = db.prepare('SELECT proposed_by, bond_credits, bond_released FROM proposals WHERE id = ?').get(proposalId) as Proposal | undefined;
    if (!proposal || proposal.bond_credits <= 0 || proposal.bond_released) return;
    db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(proposal.bond_credits, proposal.proposed_by);
    db.prepare('UPDATE proposals SET bond_released = 1 WHERE id = ?').run(proposalId);
    logger.debug({ proposalId, credits: proposal.bond_credits }, 'Proposal bond released');
  })();
}

export function getProposals(status?: string, limit = 50, offset = 0): Proposal[] {
  const db = getDb();
  // Auto-close expired proposals + release bonds
  const expired = db.prepare(`SELECT id FROM proposals WHERE status = 'OPEN' AND closes_at < datetime('now')`).all() as { id: string }[];
  if (expired.length > 0) {
    db.prepare(`UPDATE proposals SET status = 'CLOSED' WHERE status = 'OPEN' AND closes_at < datetime('now')`).run();
    for (const p of expired) {
      releaseBond(p.id);
      // Auto-execute if eligible
      const proposal = db.prepare('SELECT action_type FROM proposals WHERE id = ?').get(p.id) as { action_type: string | null } | undefined;
      if (proposal?.action_type) {
        try { executeProposal(p.id); } catch (err) { logger.warn({ proposalId: p.id, err }, 'Auto-execute failed'); }
      }
    }
  }
  const where = status ? `WHERE status = ?` : ``;
  return db.prepare(`SELECT * FROM proposals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...(status ? [status] : []), limit, offset) as Proposal[];
}

export function getProposal(id: string): Proposal | undefined {
  return getDb().prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as Proposal | undefined;
}

export function castVote(params: {
  proposalId: string;
  voterKey: string;
  direction: 'FOR' | 'AGAINST';
  weight: number;
}): { ok: boolean; error?: string } {
  if (!Number.isFinite(params.weight) || params.weight <= 0) return { ok: false, error: 'Vote weight must be a positive number' };
  const weight = Math.max(0, Math.min(1_000_000, params.weight));

  const db = getDb();
  return db.transaction(() => {
    const proposal = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(params.proposalId) as Proposal | undefined;
    if (!proposal) return { ok: false, error: 'Proposal not found' };
    if (proposal.status !== 'OPEN') return { ok: false, error: 'Proposal is not open for voting' };

    try {
      db.prepare(`INSERT INTO votes (id, proposal_id, voter_key, direction, weight) VALUES (?, ?, ?, ?, ?)`)
        .run(nanoid(16), params.proposalId, params.voterKey, params.direction, weight);
    } catch {
      return { ok: false, error: 'Already voted on this proposal' };
    }

    if (params.direction === 'FOR') {
      db.prepare(`UPDATE proposals SET votes_for = votes_for + ? WHERE id = ?`).run(weight, params.proposalId);
    } else {
      db.prepare(`UPDATE proposals SET votes_against = votes_against + ? WHERE id = ?`).run(weight, params.proposalId);
    }
    return { ok: true };
  })();
}

export function getProposalCount(status?: string): number {
  const where = status ? `WHERE status = ?` : ``;
  const row = getDb()
    .prepare(`SELECT COUNT(*) as total FROM proposals ${where}`)
    .get(...(status ? [status] : [])) as { total: number };
  return row.total;
}

export function getVoterWeight(agentKey: string): number {
  const spent = (getDb()
    .prepare(`SELECT COALESCE(SUM(amount_credits),0) as total FROM transactions WHERE from_agent = ? AND (to_agent IS NULL OR to_agent != ?)`)
    .get(agentKey, agentKey) as { total: number }).total;
  // No Math.max(1,...) floor — keys with 0 credits spent get weight=0 and are
  // rejected by castVote()'s weight<=0 guard. Prevents Sybil voting via cheap/free keys.
  return Math.sqrt(Math.max(0, spent));
}

export function getProposalVotes(proposalId: string): { voter_key: string; direction: string; weight: number; created_at: string }[] {
  return getDb()
    .prepare(`SELECT voter_key, direction, weight, created_at FROM votes WHERE proposal_id = ? ORDER BY created_at DESC`)
    .all(proposalId) as { voter_key: string; direction: string; weight: number; created_at: string }[];
}

// ─── Quorum & Governance Execution ──────────────────────────────────────────

/** Count active keys (used in last 30 days) for quorum calculation. */
export function getActiveKeyCount(): number {
  // Count keys that either have credits_used > 0 or were created in last 30 days
  const row = getDb().prepare(`
    SELECT COUNT(*) as n FROM api_keys
    WHERE active = 1 AND key NOT IN ('clawhub-treasury', 'clawhub-official')
  `).get() as { n: number };
  return row.n;
}

/** Check if a proposal has met its quorum requirement. */
export function checkQuorum(proposalId: string): { met: boolean; voterCount: number; requiredCount: number; activeKeys: number } {
  const db = getDb();
  const proposal = db.prepare('SELECT quorum_pct FROM proposals WHERE id = ?').get(proposalId) as { quorum_pct: number } | undefined;
  if (!proposal || proposal.quorum_pct <= 0) return { met: true, voterCount: 0, requiredCount: 0, activeKeys: 0 };

  const voterCount = (db.prepare('SELECT COUNT(DISTINCT voter_key) as n FROM votes WHERE proposal_id = ?').get(proposalId) as { n: number }).n;
  const activeKeys = getActiveKeyCount();
  const requiredCount = Math.ceil(activeKeys * (proposal.quorum_pct / 100));

  return { met: voterCount >= requiredCount, voterCount, requiredCount, activeKeys };
}

/** Allowed executable action types. */
const ALLOWED_ACTIONS = ['SKILL_DELIST', 'SKILL_VERIFY', 'PARAMETER_CHANGE'] as const;

/**
 * Execute a closed proposal if quorum met and majority FOR.
 * Only processes proposals with an action_type set.
 * Returns execution result or null if not eligible.
 */
export function executeProposal(proposalId: string): { executed: boolean; result?: string; error?: string } {
  const db = getDb();
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as Proposal | undefined;
  if (!proposal) return { executed: false, error: 'Proposal not found' };
  if (proposal.status !== 'CLOSED') return { executed: false, error: 'Proposal must be CLOSED' };
  if (proposal.executed_at) return { executed: false, error: 'Already executed' };
  if (!proposal.action_type) return { executed: false, error: 'No action type set' };
  if (!ALLOWED_ACTIONS.includes(proposal.action_type as typeof ALLOWED_ACTIONS[number])) {
    return { executed: false, error: `Invalid action type: ${proposal.action_type}` };
  }
  if (proposal.votes_for <= proposal.votes_against) return { executed: false, error: 'Majority not FOR' };

  const quorum = checkQuorum(proposalId);
  if (!quorum.met) return { executed: false, error: `Quorum not met (${quorum.voterCount}/${quorum.requiredCount})` };

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(proposal.action_payload_json ?? '{}'); } catch { /* ignore */ }

  let resultMsg = '';

  try {
    switch (proposal.action_type) {
      case 'SKILL_DELIST': {
        const skillId = payload.skillId as string;
        if (!skillId) return { executed: false, error: 'Missing skillId in payload' };
        db.prepare('UPDATE skills SET active = 0, public = 0 WHERE id = ?').run(skillId);
        resultMsg = `Skill ${skillId} delisted by governance vote`;
        break;
      }
      case 'SKILL_VERIFY': {
        const skillId = payload.skillId as string;
        if (!skillId) return { executed: false, error: 'Missing skillId in payload' };
        db.prepare("UPDATE skills SET security_status = 'VERIFIED' WHERE id = ?").run(skillId);
        resultMsg = `Skill ${skillId} verified by governance vote`;
        break;
      }
      case 'PARAMETER_CHANGE': {
        const param = payload.parameter as string;
        const value = payload.value as number;
        if (!param || value == null) return { executed: false, error: 'Missing parameter/value' };
        // Bounded parameter changes
        if (param === 'PLATFORM_FEE_PCT' && (value < 1 || value > 50)) return { executed: false, error: 'Fee must be 1-50%' };
        if (param === 'ORCHESTRATION_FEE' && (value < 0 || value > 100)) return { executed: false, error: 'Orch fee must be 0-100' };
        // Store in platform_config table (runtime only, not .env)
        db.exec(`CREATE TABLE IF NOT EXISTS platform_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
        db.prepare('INSERT OR REPLACE INTO platform_config (key, value, updated_at) VALUES (?, ?, datetime(?))').run(param, String(value), 'now');
        resultMsg = `Parameter ${param} set to ${value} by governance vote`;
        break;
      }
    }

    db.prepare(`UPDATE proposals SET status = 'EXECUTED', executed_at = datetime('now'), execution_result_json = ? WHERE id = ?`)
      .run(JSON.stringify({ success: true, message: resultMsg }), proposalId);
    logger.info({ proposalId, action: proposal.action_type, result: resultMsg }, 'Governance proposal executed');
    return { executed: true, result: resultMsg };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    db.prepare(`UPDATE proposals SET execution_result_json = ? WHERE id = ?`)
      .run(JSON.stringify({ success: false, error: errorMsg }), proposalId);
    return { executed: false, error: errorMsg };
  }
}
