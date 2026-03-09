/**
 * Unit tests — Governance proposals and voting
 *
 * Tests:
 *  - createProposal creates an OPEN proposal
 *  - castVote FOR / AGAINST updates tallies
 *  - Duplicate vote on same proposal is rejected
 *  - Vote on non-existent proposal fails
 *  - Vote on closed proposal fails
 *  - Weight is correctly reflected in tally
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  initDb,
  createProposal,
  getProposal,
  getProposals,
  castVote,
} from '../../src/db/index';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getTestDb().prepare('DELETE FROM proposals').run();
  getTestDb().prepare('DELETE FROM votes').run();
  getTestDb().prepare('DELETE FROM api_keys').run();
});

function makeProposal(proposedBy = 'cn-proposer', closeDays = 7): string {
  return createProposal({
    title: 'Test Proposal Title',
    description: 'A description long enough to meet the 20-char minimum.',
    proposedBy,
    closeDays,
  });
}

describe('createProposal', () => {
  it('creates a proposal in OPEN state', () => {
    const id = makeProposal();
    const p = getProposal(id);

    expect(p).toBeTruthy();
    expect(p?.status).toBe('OPEN');
    expect(p?.votes_for).toBe(0);
    expect(p?.votes_against).toBe(0);
    expect(p?.title).toBe('Test Proposal Title');
  });

  it('shows up in getProposals with OPEN filter', () => {
    makeProposal();
    const list = getProposals('OPEN');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every(p => p.status === 'OPEN')).toBe(true);
  });
});

describe('castVote', () => {
  it('FOR vote increments votes_for', () => {
    const id = makeProposal();
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    const result = castVote({ proposalId: id, voterKey: key, direction: 'FOR', weight: 1 });

    expect(result.ok).toBe(true);
    expect(getProposal(id)?.votes_for).toBeCloseTo(1);
    expect(getProposal(id)?.votes_against).toBe(0);
  });

  it('AGAINST vote increments votes_against', () => {
    const id = makeProposal();
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    const result = castVote({ proposalId: id, voterKey: key, direction: 'AGAINST', weight: 2.5 });

    expect(result.ok).toBe(true);
    expect(getProposal(id)?.votes_against).toBeCloseTo(2.5);
    expect(getProposal(id)?.votes_for).toBe(0);
  });

  it('weighted vote accumulates correctly across voters', () => {
    const id = makeProposal();
    const { key: key1 } = seedApiKey(getTestDb(), { credits: 100 });
    const { key: key2 } = seedApiKey(getTestDb(), { credits: 100 });
    const { key: key3 } = seedApiKey(getTestDb(), { credits: 100 });

    castVote({ proposalId: id, voterKey: key1, direction: 'FOR', weight: 3 });
    castVote({ proposalId: id, voterKey: key2, direction: 'FOR', weight: 1.5 });
    castVote({ proposalId: id, voterKey: key3, direction: 'AGAINST', weight: 2 });

    const p = getProposal(id);
    expect(p?.votes_for).toBeCloseTo(4.5);
    expect(p?.votes_against).toBeCloseTo(2);
  });

  it('duplicate vote on the same proposal is rejected', () => {
    const id = makeProposal();
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    castVote({ proposalId: id, voterKey: key, direction: 'FOR', weight: 1 });
    const second = castVote({ proposalId: id, voterKey: key, direction: 'AGAINST', weight: 1 });

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already voted/i);
    // Tally should only reflect the first vote
    expect(getProposal(id)?.votes_for).toBeCloseTo(1);
    expect(getProposal(id)?.votes_against).toBe(0);
  });

  it('vote on non-existent proposal fails', () => {
    const result = castVote({ proposalId: 'does-not-exist', voterKey: 'cn-voter', direction: 'FOR', weight: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('vote on closed proposal is rejected', () => {
    const id = makeProposal();
    // Force-close the proposal
    getTestDb().prepare(`UPDATE proposals SET status = 'CLOSED' WHERE id = ?`).run(id);

    const { key } = seedApiKey(getTestDb(), { credits: 100 });
    const result = castVote({ proposalId: id, voterKey: key, direction: 'FOR', weight: 1 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not open/i);
    expect(getProposal(id)?.votes_for).toBe(0);
  });
});

describe('getProposals — status filter', () => {
  it('returns only proposals matching the requested status', () => {
    const openId = makeProposal();
    makeProposal();
    // Close one
    getTestDb().prepare(`UPDATE proposals SET status = 'CLOSED' WHERE id = ?`).run(openId);

    const openList = getProposals('OPEN');
    const closedList = getProposals('CLOSED');

    expect(openList.every(p => p.status === 'OPEN')).toBe(true);
    expect(closedList.every(p => p.status === 'CLOSED')).toBe(true);
    expect(closedList.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-closes expired proposals when listing', () => {
    // Create a proposal that expired yesterday
    const id = makeProposal();
    getTestDb()
      .prepare(`UPDATE proposals SET closes_at = datetime('now', '-1 day') WHERE id = ?`)
      .run(id);

    // Calling getProposals triggers auto-close
    getProposals();

    expect(getProposal(id)?.status).toBe('CLOSED');
  });
});
