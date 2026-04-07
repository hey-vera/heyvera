// src/db/signal.ts — Founding Protocol: Signal points earning + Founding Vault + milestones
import { getDb } from './connection';
import { nanoid } from 'nanoid';
import { round6 } from '../core/credits';
import { logger } from '../utils/logger';

// ── Signal Actions & Rewards ──────────────────────────────────────────────────
// Signal is NEVER purchasable. Only earned through platform usage.

export const SIGNAL_REWARDS = {
  // Provider actions
  provider_register:      100,
  endpoint_listed:        200,
  endpoint_called:        1,     // per call on provider's endpoint
  cache_hit:              0.5,   // per cache hit (provider earns while sleeping)
  soma_verified:          300,
  provider_referral:      1000,  // referred provider lists 3+ endpoints
  uptime_streak_7d:       500,

  // Agent/developer actions
  agent_signup:           100,
  first_api_call:         50,
  unique_endpoints_10:    500,   // called 10 unique endpoints
  orchestration_call:     2,     // per orchestration call
  soma_verify_request:    200,
  cache_hit_agent:        1,     // agent used If-Soma-Hash

  // Computation verification (Heartbeat Fraud Proofs)
  computation_verified:   5,     // spot-checks passed for a computation

  // Vault
  vault_daily_per_1k:     10,    // per 1K credits locked per day
} as const;

export type SignalAction = keyof typeof SIGNAL_REWARDS;

// ── Award Signal ──────────────────────────────────────────────────────────────
// Fire-and-forget, same pattern as logAudit(). Never blocks the request.

export function awardSignal(opts: {
  apiKey: string;
  providerId?: string;
  action: SignalAction;
  multiplier?: number;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const base = SIGNAL_REWARDS[opts.action];
    const signal = Math.round(base * (opts.multiplier ?? 1));
    if (signal <= 0) return;

    const id = `sig-${nanoid(16)}`;
    const db = getDb();

    db.prepare(`
      INSERT INTO signal_events (id, api_key, provider_id, action, signal, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, opts.apiKey, opts.providerId ?? null, opts.action, signal,
      opts.metadata ? JSON.stringify(opts.metadata) : null);

    // Upsert balance
    db.prepare(`
      INSERT INTO signal_balances (api_key, provider_id, total_signal, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(api_key) DO UPDATE SET
        total_signal = total_signal + ?,
        provider_id = COALESCE(excluded.provider_id, provider_id),
        updated_at = datetime('now')
    `).run(opts.apiKey, opts.providerId ?? null, signal, signal);

  } catch (err) {
    logger.warn({ err, action: opts.action }, 'Signal award failed (non-fatal)');
  }
}

// ── Query Signal ──────────────────────────────────────────────────────────────

export function getSignalBalance(apiKey: string): number {
  const row = getDb().prepare('SELECT total_signal FROM signal_balances WHERE api_key = ?').get(apiKey) as any;
  return row?.total_signal ?? 0;
}

export function getSignalLeaderboard(limit = 50, offset = 0): Array<{
  apiKey: string; providerId: string | null; totalSignal: number;
}> {
  return (getDb().prepare(`
    SELECT api_key, provider_id, total_signal
    FROM signal_balances
    ORDER BY total_signal DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as any[]).map(r => ({
    apiKey: r.api_key,
    providerId: r.provider_id,
    totalSignal: r.total_signal,
  }));
}

export function getSignalStats(): { totalSignal: number; participants: number; topAction: string | null } {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(total_signal), 0) as total, COUNT(*) as participants
    FROM signal_balances WHERE total_signal > 0
  `).get() as any;
  const topAction = getDb().prepare(`
    SELECT action, SUM(signal) as total FROM signal_events
    GROUP BY action ORDER BY total DESC LIMIT 1
  `).get() as any;
  return {
    totalSignal: row?.total ?? 0,
    participants: row?.participants ?? 0,
    topAction: topAction?.action ?? null,
  };
}

export function getSignalHistory(apiKey: string, limit = 50): Array<{
  action: string; signal: number; createdAt: string; metadata: unknown;
}> {
  return (getDb().prepare(`
    SELECT action, signal, created_at, metadata_json
    FROM signal_events WHERE api_key = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(apiKey, limit) as any[]).map(r => ({
    action: r.action,
    signal: r.signal,
    createdAt: r.created_at,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
  }));
}

// ── Founding Vault ────────────────────────────────────────────────────────────

const VAULT_TIERS = [
  { minDays: 180, multiplier: 2.0,  dailySignalPer1k: 20 },
  { minDays: 90,  multiplier: 1.5,  dailySignalPer1k: 15 },
  { minDays: 30,  multiplier: 1.25, dailySignalPer1k: 10 },
] as const;

function vaultTier(lockDays: number) {
  for (const t of VAULT_TIERS) {
    if (lockDays >= t.minDays) return t;
  }
  return VAULT_TIERS[VAULT_TIERS.length - 1];
}

export function createVaultLock(opts: {
  apiKey: string;
  providerId?: string;
  credits: number;
  lockDays: number;
}): { id: string; multiplier: number; unlocksAt: string } {
  if (opts.lockDays < 30) throw new Error('Minimum lock is 30 days');
  if (opts.credits <= 0) throw new Error('Must lock positive credits');

  // Check max 500K per account
  const existing = getDb().prepare(`
    SELECT COALESCE(SUM(credits_locked), 0) as total
    FROM founding_vault WHERE api_key = ? AND status = 'locked'
  `).get(opts.apiKey) as any;
  if ((existing?.total ?? 0) + opts.credits > 500_000) {
    throw new Error('Max 500K credits lockable per account');
  }

  const tier = vaultTier(opts.lockDays);
  const id = `vault-${nanoid(16)}`;
  const unlocksAt = new Date(Date.now() + opts.lockDays * 86400_000).toISOString();

  getDb().prepare(`
    INSERT INTO founding_vault (id, api_key, provider_id, credits_locked, lock_days, unlocks_at, multiplier)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.apiKey, opts.providerId ?? null, opts.credits, opts.lockDays, unlocksAt, tier.multiplier);

  return { id, multiplier: tier.multiplier, unlocksAt };
}

export function getVaultLocks(apiKey: string): Array<{
  id: string; creditsLocked: number; lockDays: number; multiplier: number;
  status: string; lockedAt: string; unlocksAt: string; signalEarned: number;
}> {
  return (getDb().prepare(`
    SELECT * FROM founding_vault WHERE api_key = ? ORDER BY locked_at DESC
  `).all(apiKey) as any[]).map(r => ({
    id: r.id,
    creditsLocked: r.credits_locked,
    lockDays: r.lock_days,
    multiplier: r.multiplier,
    status: r.status,
    lockedAt: r.locked_at,
    unlocksAt: r.unlocks_at,
    signalEarned: r.signal_earned,
  }));
}

export function requestVaultUnlock(lockId: string, apiKey: string): { unlocksAt: string } {
  const lock = getDb().prepare(
    `SELECT * FROM founding_vault WHERE id = ? AND api_key = ? AND status = 'locked'`
  ).get(lockId, apiKey) as any;
  if (!lock) throw new Error('Lock not found or already unlocking');

  // 7-day cooldown — no multiplier on early unlock
  const cooldownEnd = new Date(Date.now() + 7 * 86400_000).toISOString();
  getDb().prepare(`
    UPDATE founding_vault SET status = 'unlocking', unlocks_at = ?, multiplier = 1.0
    WHERE id = ?
  `).run(cooldownEnd, lockId);

  return { unlocksAt: cooldownEnd };
}

export function extendVaultLock(lockId: string, apiKey: string, newLockDays: number): { multiplier: number; unlocksAt: string } {
  const lock = getDb().prepare(
    `SELECT * FROM founding_vault WHERE id = ? AND api_key = ? AND status = 'locked'`
  ).get(lockId, apiKey) as any;
  if (!lock) throw new Error('Lock not found');
  if (newLockDays <= lock.lock_days) throw new Error('Can only extend, not shorten');

  const tier = vaultTier(newLockDays);
  const unlocksAt = new Date(new Date(lock.locked_at).getTime() + newLockDays * 86400_000).toISOString();

  getDb().prepare(`
    UPDATE founding_vault SET lock_days = ?, multiplier = ?, unlocks_at = ?
    WHERE id = ?
  `).run(newLockDays, tier.multiplier, unlocksAt, lockId);

  return { multiplier: tier.multiplier, unlocksAt };
}

// ── Vault Signal Drip (called by cron) ────────────────────────────────────────
// Awards daily Signal to all active vault locks based on credits locked.

export function processVaultSignalDrip(): number {
  const locks = getDb().prepare(
    `SELECT * FROM founding_vault WHERE status = 'locked'`
  ).all() as any[];

  let awarded = 0;
  for (const lock of locks) {
    const tier = vaultTier(lock.lock_days);
    const signal = Math.round(lock.credits_locked / 1000 * tier.dailySignalPer1k);
    if (signal <= 0) continue;

    awardSignal({
      apiKey: lock.api_key,
      providerId: lock.provider_id,
      action: 'vault_daily_per_1k',
      multiplier: lock.credits_locked / 1000,
      metadata: { vaultId: lock.id, lockDays: lock.lock_days },
    });

    getDb().prepare(`
      UPDATE founding_vault SET signal_earned = signal_earned + ? WHERE id = ?
    `).run(signal, lock.id);

    awarded += signal;
  }
  return awarded;
}

// ── Process Vault Unlocks (called by cron) ────────────────────────────────────

export function processVaultUnlocks(): number {
  const now = new Date().toISOString();
  const result = getDb().prepare(`
    UPDATE founding_vault SET status = 'unlocked', unlocked_at = datetime('now')
    WHERE status = 'unlocking' AND unlocks_at <= ?
  `).run(now);
  return result.changes;
}

// ── Network Milestones ────────────────────────────────────────────────────────

export function getMilestones(): Array<{
  id: string; name: string; description: string;
  targetValue: number; currentValue: number;
  rewardType: string; rewardValue: string;
  reached: boolean; reachedAt: string | null;
}> {
  return (getDb().prepare('SELECT * FROM network_milestones ORDER BY target_value ASC').all() as any[]).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    targetValue: r.target_value,
    currentValue: r.current_value,
    rewardType: r.reward_type,
    rewardValue: r.reward_value,
    reached: !!r.reached,
    reachedAt: r.reached_at,
  }));
}

export function updateMilestoneProgress(id: string, currentValue: number): boolean {
  const milestone = getDb().prepare('SELECT * FROM network_milestones WHERE id = ?').get(id) as any;
  if (!milestone || milestone.reached) return false;

  const reached = currentValue >= milestone.target_value;
  getDb().prepare(`
    UPDATE network_milestones SET current_value = ?, reached = ?, reached_at = ?
    WHERE id = ?
  `).run(currentValue, reached ? 1 : 0, reached ? new Date().toISOString() : null, id);

  return reached;
}

export function seedMilestones(): void {
  const count = (getDb().prepare('SELECT COUNT(*) as c FROM network_milestones').get() as any).c;
  if (count > 0) return; // already seeded

  const milestones = [
    { id: 'ms-providers-100',    name: '100 Providers',        desc: '100 registered providers on the network',    target: 100,    reward: 'signal',     value: '500' },
    { id: 'ms-endpoints-1000',   name: '1,000 Endpoints',      desc: '1,000 unique endpoints live on the registry', target: 1000,   reward: 'cache_boost', value: '60' },
    { id: 'ms-calls-10k',        name: '10,000 Daily Calls',   desc: '10,000 API calls in a single day',           target: 10000,  reward: 'vault_boost', value: '0.25' },
    { id: 'ms-soma-100',         name: '100 Soma Verifications', desc: '100 completed Soma verifications',          target: 100,    reward: 'badge',       value: 'soma_pioneer' },
    { id: 'ms-revenue-10k',      name: '$10K Provider Revenue',  desc: '$10,000 in total provider revenue',          target: 10000,  reward: 'event',       value: 'community_ama' },
  ];

  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO network_milestones (id, name, description, target_value, reward_type, reward_value)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const m of milestones) {
    stmt.run(m.id, m.name, m.desc, m.target, m.reward, m.value);
  }
}
