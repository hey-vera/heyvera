import { nanoid } from 'nanoid';
import { getDb } from './connection';
import { round6 } from '../core/credits';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromoCode {
  id: string;
  code: string;
  credits_amount: number;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
  event_name: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  created_by: string | null;
}

export interface PromoRedemption {
  id: string;
  promo_code_id: string;
  api_key: string;
  credits_granted: number;
  redeemed_at: string;
}

// ─── Admin CRUD ─────────────────────────────────────────────────────────────

export function createPromoCode(opts: {
  code: string;
  creditsAmount: number;
  maxUses: number;
  expiresAt?: string;
  eventName?: string;
  notes?: string;
  createdBy?: string;
}): PromoCode {
  const id = `promo-${nanoid(12)}`;
  getDb().prepare(`
    INSERT INTO promo_codes (id, code, credits_amount, max_uses, expires_at, event_name, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.code.toUpperCase(), round6(opts.creditsAmount), opts.maxUses, opts.expiresAt ?? null, opts.eventName ?? null, opts.notes ?? null, opts.createdBy ?? null);

  return getDb().prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as PromoCode;
}

export function getPromoCode(id: string): PromoCode | undefined {
  return getDb().prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as PromoCode | undefined;
}

export function getPromoCodeByCode(code: string): PromoCode | undefined {
  return getDb().prepare('SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE').get(code.toUpperCase()) as PromoCode | undefined;
}

export function listPromoCodes(): PromoCode[] {
  return getDb().prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all() as PromoCode[];
}

export function deactivatePromoCode(id: string): boolean {
  const result = getDb().prepare('UPDATE promo_codes SET active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─── Redemption ─────────────────────────────────────────────────────────────

export interface RedeemResult {
  ok: boolean;
  error?: string;
  code?: string;
  creditsGranted?: number;
}

export function redeemPromoCode(code: string, apiKey: string): RedeemResult {
  const promo = getPromoCodeByCode(code);
  if (!promo) return { ok: false, error: 'Invalid promo code', code: 'INVALID_CODE' };
  if (!promo.active) return { ok: false, error: 'Promo code is no longer active', code: 'CODE_INACTIVE' };
  if (promo.current_uses >= promo.max_uses) return { ok: false, error: 'Promo code has reached maximum redemptions', code: 'CODE_EXHAUSTED' };
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) return { ok: false, error: 'Promo code has expired', code: 'CODE_EXPIRED' };

  // Check one-per-account
  const existing = getDb().prepare(
    'SELECT id FROM promo_redemptions WHERE promo_code_id = ? AND api_key = ?'
  ).get(promo.id, apiKey);
  if (existing) return { ok: false, error: 'You have already redeemed this code', code: 'ALREADY_REDEEMED' };

  const credits = round6(promo.credits_amount);

  getDb().transaction(() => {
    // Increment usage
    getDb().prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?').run(promo.id);
    // Grant credits
    getDb().prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(credits, apiKey);
    // Record redemption
    getDb().prepare(`
      INSERT INTO promo_redemptions (id, promo_code_id, api_key, credits_granted)
      VALUES (?, ?, ?, ?)
    `).run(`pr-${nanoid(12)}`, promo.id, apiKey, credits);
  })();

  return { ok: true, creditsGranted: credits };
}

export function getRedemptionsForCode(promoCodeId: string): PromoRedemption[] {
  return getDb().prepare(
    'SELECT * FROM promo_redemptions WHERE promo_code_id = ? ORDER BY redeemed_at DESC'
  ).all(promoCodeId) as PromoRedemption[];
}

export function getRedemptionsForKey(apiKey: string): PromoRedemption[] {
  return getDb().prepare(
    'SELECT * FROM promo_redemptions WHERE api_key = ? ORDER BY redeemed_at DESC'
  ).all(apiKey) as PromoRedemption[];
}
