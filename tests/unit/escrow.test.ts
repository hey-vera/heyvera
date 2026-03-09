/**
 * Unit tests — Escrow state machine
 *
 * State flow:
 *   CREATED → FUNDED → WORK_IN_PROGRESS → COMPLETED → (RELEASED via releaseEscrow)
 *                     ↓
 *                DISPUTED → RESOLVED
 *   FUNDED → REFUNDED (expired)
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  initDb,
  createEscrow,
  getEscrow,
  fundEscrow,
  releaseEscrow,
  transitionEscrow,
  getApiKeyBalance,
} from '../../src/db/index';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getTestDb().prepare('DELETE FROM escrows').run();
  getTestDb().prepare('DELETE FROM api_keys').run();
  getTestDb().prepare('DELETE FROM audit_log').run();
});

function makeEscrow(hirerId: string, workerId: string, amount = 200): string {
  const id = `esc_${Math.random().toString(36).slice(2)}`;
  createEscrow({ id, hirerId, workerId, amountCredits: amount });
  return id;
}

describe('createEscrow / getEscrow', () => {
  it('creates an escrow in CREATED state', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 1000 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 300);
    const esc = getEscrow(id);

    expect(esc).toBeTruthy();
    expect(esc?.state).toBe('CREATED');
    expect(esc?.amount_credits).toBe(300);
    expect(esc?.hirer_id).toBe(hirer);
    expect(esc?.worker_id).toBe(worker);
  });
});

describe('fundEscrow', () => {
  it('transitions to FUNDED and deducts credits from hirer', () => {
    const { key: hirerKey, clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 500 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 200);
    const result = fundEscrow(id, hirer);

    expect(result.ok).toBe(true);
    expect(getEscrow(id)?.state).toBe('FUNDED');
    expect(getApiKeyBalance(hirerKey)?.credits).toBe(300); // 500 - 200
  });

  it('fails when hirer has insufficient credits', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 50 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 200);
    const result = fundEscrow(id, hirer);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/insufficient/i);
    expect(getEscrow(id)?.state).toBe('CREATED'); // unchanged
  });

  it('fails if called by wrong party', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 500 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });
    const { clerkUserId: intruder } = seedApiKey(getTestDb(), { credits: 500 });

    const id = makeEscrow(hirer, worker, 100);
    const result = fundEscrow(id, intruder);

    expect(result.ok).toBe(false);
    expect(getEscrow(id)?.state).toBe('CREATED');
  });

  it('fails if escrow is not in CREATED state', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 1000 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 100);
    fundEscrow(id, hirer); // First fund succeeds
    const second = fundEscrow(id, hirer); // Already FUNDED

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/cannot fund/i);
  });
});

describe('releaseEscrow', () => {
  it('pays credits to worker when work is COMPLETED', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 1000 });
    const { key: workerKey, clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 300);
    fundEscrow(id, hirer);
    transitionEscrow(id, 'WORK_IN_PROGRESS');
    // releaseEscrow handles the WORK_IN_PROGRESS → COMPLETED transition itself
    const result = releaseEscrow(id);

    expect(result.ok).toBe(true);
    expect(getApiKeyBalance(workerKey)?.credits).toBe(300);
  });

  it('fails if escrow is not COMPLETED', () => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 500 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });

    const id = makeEscrow(hirer, worker, 100);
    fundEscrow(id, hirer);
    // Still FUNDED, not COMPLETED

    const result = releaseEscrow(id);
    expect(result.ok).toBe(false);
  });
});

describe('transitionEscrow — state machine validity', () => {
  const validPaths: Array<[string, string]> = [
    ['CREATED', 'FUNDED'],
    ['FUNDED', 'WORK_IN_PROGRESS'],
    ['FUNDED', 'REFUNDED'],
    ['WORK_IN_PROGRESS', 'COMPLETED'],
    ['WORK_IN_PROGRESS', 'DISPUTED'],
    ['DISPUTED', 'RESOLVED'],
  ];

  it.each(validPaths)('%s → %s is allowed', (from, to) => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 500 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });
    const id = makeEscrow(hirer, worker, 50);

    // Advance to 'from' state
    const db = getTestDb();
    db.prepare(`UPDATE escrows SET state = ? WHERE id = ?`).run(from, id);

    const ok = transitionEscrow(id, to as any);
    expect(ok).toBe(true);
    expect(getEscrow(id)?.state).toBe(to);
  });

  const invalidPaths: Array<[string, string]> = [
    ['CREATED', 'COMPLETED'],
    ['CREATED', 'DISPUTED'],
    ['FUNDED', 'RESOLVED'],
    ['COMPLETED', 'FUNDED'],
    ['RESOLVED', 'FUNDED'],
    ['REFUNDED', 'FUNDED'],
  ];

  it.each(invalidPaths)('%s → %s is rejected', (from, to) => {
    const { clerkUserId: hirer } = seedApiKey(getTestDb(), { credits: 500 });
    const { clerkUserId: worker } = seedApiKey(getTestDb(), { credits: 0 });
    const id = makeEscrow(hirer, worker, 50);

    getTestDb().prepare(`UPDATE escrows SET state = ? WHERE id = ?`).run(from, id);

    const ok = transitionEscrow(id, to as any);
    expect(ok).toBe(false);
    expect(getEscrow(id)?.state).toBe(from); // unchanged
  });
});
