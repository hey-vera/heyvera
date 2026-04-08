/**
 * Vouch Graph Tests — agent-to-agent trust staking (Layer 4)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import {
  stakeVouch,
  revokeVouch,
  slashVouches,
  getVouchesFor,
  getVouchesBy,
  getVouchScore,
  resolveVouchPath,
  expireVouches,
} from '../../src/core/vouch-graph';

initDb();

const ALICE = 'did:key:alice';
const BOB = 'did:key:bob';
const CHARLIE = 'did:key:charlie';
const DAVE = 'did:key:dave';

beforeEach(() => {
  getDb().exec('DELETE FROM vouch_stakes');
});

// ─── Staking ─────────────────────────────────────────────────────────────────

describe('Vouch staking', () => {
  it('creates a vouch stake', () => {
    const stake = stakeVouch(ALICE, BOB, 10);
    expect(stake.id).toMatch(/^vs-/);
    expect(stake.voucherDid).toBe(ALICE);
    expect(stake.voucheeDid).toBe(BOB);
    expect(stake.stakeAmount).toBe(10);
    expect(stake.status).toBe('active');
  });

  it('rejects self-vouch', () => {
    expect(() => stakeVouch(ALICE, ALICE, 10)).toThrow('Cannot vouch for yourself');
  });

  it('rejects stake below minimum', () => {
    expect(() => stakeVouch(ALICE, BOB, 0.5)).toThrow('Minimum stake');
  });

  it('rejects duplicate active vouch', () => {
    stakeVouch(ALICE, BOB, 10);
    expect(() => stakeVouch(ALICE, BOB, 20)).toThrow('Active vouch already exists');
  });

  it('allows re-vouch after revoke', () => {
    stakeVouch(ALICE, BOB, 10);
    revokeVouch(ALICE, BOB);
    const stake = stakeVouch(ALICE, BOB, 20);
    expect(stake.stakeAmount).toBe(20);
  });
});

// ─── Revoking ────────────────────────────────────────────────────────────────

describe('Vouch revoking', () => {
  it('revokes an active vouch', () => {
    stakeVouch(ALICE, BOB, 10);
    expect(revokeVouch(ALICE, BOB)).toBe(true);
    expect(getVouchesFor(BOB)).toHaveLength(0);
  });

  it('returns false for non-existent vouch', () => {
    expect(revokeVouch(ALICE, BOB)).toBe(false);
  });
});

// ─── Slashing ────────────────────────────────────────────────────────────────

describe('Vouch slashing', () => {
  it('slashes all vouches for a bad actor', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(CHARLIE, BOB, 20);
    const count = slashVouches(BOB, 'red_verdicts');
    expect(count).toBe(2);
    expect(getVouchesFor(BOB)).toHaveLength(0);
  });

  it('records slash reason', () => {
    stakeVouch(ALICE, BOB, 10);
    slashVouches(BOB, 'agent_death');
    const all = getDb().prepare("SELECT * FROM vouch_stakes WHERE vouchee_did = ?").all(BOB) as any[];
    expect(all[0].status).toBe('slashed');
    expect(all[0].slash_reason).toBe('agent_death');
  });

  it('returns 0 when no vouches to slash', () => {
    expect(slashVouches(BOB, 'test')).toBe(0);
  });

  it('slashed agent has slash count in score', () => {
    stakeVouch(ALICE, BOB, 10);
    slashVouches(BOB, 'test');
    const score = getVouchScore(BOB);
    expect(score.slashCount).toBe(1);
  });
});

// ─── Queries ─────────────────────────────────────────────────────────────────

describe('Vouch queries', () => {
  it('getVouchesFor returns vouchers sorted by stake', () => {
    stakeVouch(ALICE, CHARLIE, 5);
    stakeVouch(BOB, CHARLIE, 20);
    const vouchers = getVouchesFor(CHARLIE);
    expect(vouchers).toHaveLength(2);
    expect(vouchers[0].voucherDid).toBe(BOB); // higher stake first
    expect(vouchers[1].voucherDid).toBe(ALICE);
  });

  it('getVouchesBy returns who an agent vouches for', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(ALICE, CHARLIE, 5);
    const vouching = getVouchesBy(ALICE);
    expect(vouching).toHaveLength(2);
  });

  it('getVouchScore computes aggregates', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(CHARLIE, BOB, 30);
    const score = getVouchScore(BOB);
    expect(score.totalStaked).toBe(40);
    expect(score.uniqueVouchers).toBe(2);
    expect(score.avgStake).toBe(20);
    expect(score.strongestVouch).toBe(30);
    expect(score.slashCount).toBe(0);
  });

  it('empty score for unknown agent', () => {
    const score = getVouchScore('did:key:nobody');
    expect(score.totalStaked).toBe(0);
    expect(score.uniqueVouchers).toBe(0);
  });
});

// ─── Transitive Trust Resolution ─────────────────────────────────────────────

describe('Transitive trust resolution', () => {
  it('finds direct vouch (1 hop)', () => {
    stakeVouch(ALICE, BOB, 10);
    const path = resolveVouchPath(ALICE, BOB);
    expect(path).not.toBeNull();
    expect(path!.depth).toBe(1);
    expect(path!.hops).toHaveLength(1);
    expect(path!.minStake).toBe(10);
  });

  it('finds 2-hop path', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(BOB, CHARLIE, 5);
    const path = resolveVouchPath(ALICE, CHARLIE);
    expect(path).not.toBeNull();
    expect(path!.depth).toBe(2);
    expect(path!.minStake).toBe(5); // weakest link
  });

  it('finds 3-hop path', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(BOB, CHARLIE, 5);
    stakeVouch(CHARLIE, DAVE, 20);
    const path = resolveVouchPath(ALICE, DAVE);
    expect(path).not.toBeNull();
    expect(path!.depth).toBe(3);
    expect(path!.minStake).toBe(5);
  });

  it('returns null for no path', () => {
    stakeVouch(ALICE, BOB, 10);
    // No connection from Alice to Charlie
    expect(resolveVouchPath(ALICE, CHARLIE)).toBeNull();
  });

  it('returns null for self-resolve', () => {
    expect(resolveVouchPath(ALICE, ALICE)).toBeNull();
  });

  it('does not follow revoked vouches', () => {
    stakeVouch(ALICE, BOB, 10);
    stakeVouch(BOB, CHARLIE, 5);
    revokeVouch(BOB, CHARLIE);
    expect(resolveVouchPath(ALICE, CHARLIE)).toBeNull();
  });
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

describe('Vouch expiry', () => {
  it('expires past-TTL vouches', () => {
    // Insert a vouch that already expired
    getDb().prepare(`
      INSERT INTO vouch_stakes (id, voucher_did, vouchee_did, stake_amount, status, expires_at)
      VALUES ('vs-expired', ?, ?, 10, 'active', datetime('now', '-1 day'))
    `).run(ALICE, BOB);

    const count = expireVouches();
    expect(count).toBe(1);
    expect(getVouchesFor(BOB)).toHaveLength(0);
  });

  it('does not expire vouches without TTL', () => {
    stakeVouch(ALICE, BOB, 10);
    const count = expireVouches();
    expect(count).toBe(0);
    expect(getVouchesFor(BOB)).toHaveLength(1);
  });
});
