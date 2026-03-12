import { nanoid } from 'nanoid';
import { getDb } from './connection';

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
}

export function createProposal(params: {
  title: string;
  description: string;
  proposedBy: string;
  closeDays?: number;
}): string {
  const id = nanoid(16);
  const days = Math.max(1, Math.min(90, Math.floor(params.closeDays ?? 7)));
  getDb().prepare(`
    INSERT INTO proposals (id, title, description, proposed_by, closes_at)
    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(id, params.title, params.description, params.proposedBy, days);
  return id;
}

export function getProposals(status?: string, limit = 50, offset = 0): Proposal[] {
  const db = getDb();
  // Auto-close expired proposals
  db.prepare(`UPDATE proposals SET status = 'CLOSED' WHERE status = 'OPEN' AND closes_at < datetime('now')`).run();
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
