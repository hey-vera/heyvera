/**
 * Unit tests — Skills registry
 *
 * Tests:
 *  - createSkill / getSkill round-trip
 *  - listPublicSkills returns only public skills
 *  - incrementSkillUses increments the counter
 *  - deleteSkill enforces author ownership
 *  - Revenue share: deductCredit from buyer + topUpCredits to author (97% flow)
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  initDb,
  createSkill,
  getSkill,
  listPublicSkills,
  incrementSkillUses,
  deleteSkill,
  deductCredit,
  topUpCredits,
  getApiKeyBalance,
  recordTransaction,
  getTransactions,
} from '../../src/db/index';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getTestDb().prepare('DELETE FROM skills').run();
  getTestDb().prepare('DELETE FROM api_keys').run();
  getTestDb().prepare('DELETE FROM transactions').run();
});

function makeSkill(authorKey: string, opts: { public?: boolean; creditCost?: number; id?: string } = {}): string {
  const id = opts.id ?? `skill_${Math.random().toString(36).slice(2)}`;
  createSkill({
    id,
    name: 'Token Analyzer',
    description: 'Analyzes token metadata',
    promptTemplate: 'Analyze: {{token}}',
    authorKey,
    public: opts.public ?? true,
    creditCost: opts.creditCost ?? 10,
  });
  return id;
}

describe('createSkill / getSkill', () => {
  it('creates a skill and retrieves it by id', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    const id = makeSkill(authorKey);
    const skill = getSkill(id);

    expect(skill).toBeTruthy();
    expect(skill?.name).toBe('Token Analyzer');
    expect(skill?.author_key).toBe(authorKey);
    expect(skill?.public).toBe(1);
    expect(skill?.credit_cost).toBe(10);
    expect(skill?.uses).toBe(0);
  });

  it('returns undefined for an unknown skill id', () => {
    expect(getSkill('does-not-exist')).toBeUndefined();
  });
});

describe('listPublicSkills', () => {
  it('only returns skills with public = 1', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    makeSkill(authorKey, { public: true, id: 'pub1' });
    makeSkill(authorKey, { public: true, id: 'pub2' });
    makeSkill(authorKey, { public: false, id: 'priv1' });

    const skills = listPublicSkills();

    expect(skills.length).toBe(2);
    expect(skills.every(s => s.public === 1)).toBe(true);
    expect(skills.find(s => s.id === 'priv1')).toBeUndefined();
  });

  it('returns an empty array when no public skills exist', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    makeSkill(authorKey, { public: false });

    expect(listPublicSkills()).toHaveLength(0);
  });
});

describe('incrementSkillUses', () => {
  it('increments the uses counter each time', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    const id = makeSkill(authorKey);

    incrementSkillUses(id);
    incrementSkillUses(id);
    incrementSkillUses(id);

    expect(getSkill(id)?.uses).toBe(3);
  });
});

describe('deleteSkill', () => {
  it('allows the author to delete their own skill', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    const id = makeSkill(authorKey);

    const deleted = deleteSkill(id, authorKey);

    expect(deleted).toBe(true);
    // getSkill filters active=1, so soft-deleted skill should not be found
    expect(getSkill(id)).toBeUndefined();
    // Verify row still exists with active=0 via raw query
    const row = getTestDb().prepare('SELECT active FROM skills WHERE id = ?').get(id) as { active: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.active).toBe(0);
  });

  it('prevents non-authors from deleting', () => {
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 100 });
    const { key: intruderKey } = seedApiKey(getTestDb(), { credits: 100 });
    const id = makeSkill(authorKey);

    const deleted = deleteSkill(id, intruderKey);

    expect(deleted).toBe(false);
    expect(getSkill(id)).toBeTruthy();
  });
});

describe('skill invoke — credit + revenue share flow', () => {
  /**
   * This tests the credit accounting logic that backs skill invocations.
   * The route charges the buyer (deductCredit) then credits 97% to the author
   * (topUpCredits). We test that sequence directly here.
   */
  it('deducts from buyer and credits 97% to author', () => {
    const { key: buyerKey } = seedApiKey(getTestDb(), { credits: 500 });
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 0 });
    const skillId = makeSkill(authorKey, { creditCost: 100 });

    const cost = 100;
    const authorShare = Math.floor(cost * 0.97); // 97

    const ok = deductCredit(buyerKey, cost);
    expect(ok).toBe(true);

    topUpCredits(authorKey, authorShare);

    expect(getApiKeyBalance(buyerKey)?.credits).toBe(400);
    expect(getApiKeyBalance(authorKey)?.credits).toBe(authorShare);

    // Record the transaction (platform keeps 3%)
    const txId = recordTransaction({
      fromAgent: buyerKey,
      toAgent: authorKey,
      amountCredits: authorShare,
      type: 'SKILL_INVOKE',
      skillId,
      feeCredits: cost - authorShare, // 3 credits platform fee
    });

    const txs = getTransactions(buyerKey);
    expect(txs.length).toBe(1);
    expect(txs[0].id).toBe(txId);
    expect(txs[0].amount_credits).toBe(authorShare);
    expect(txs[0].fee_credits).toBe(3);
  });

  it('does not deduct if buyer has insufficient credits', () => {
    const { key: buyerKey } = seedApiKey(getTestDb(), { credits: 50 });
    const { key: authorKey } = seedApiKey(getTestDb(), { credits: 0 });
    makeSkill(authorKey, { creditCost: 100 });

    const ok = deductCredit(buyerKey, 100);
    expect(ok).toBe(false);

    // Author should receive nothing
    expect(getApiKeyBalance(authorKey)?.credits).toBe(0);
    expect(getApiKeyBalance(buyerKey)?.credits).toBe(50);
  });
});
