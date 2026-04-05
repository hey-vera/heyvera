/**
 * Unit tests — Soma Delegation v0.1 (migration 149)
 *
 * Covers:
 *   - Backward compat: default 1-hop delegation still works
 *   - Depth enforcement: child cannot delegate when parent.max_depth=0
 *   - Branch cap: child.spend_limit > parent.branch_spend_limit is rejected
 *   - Max-depth narrowing: child.max_depth <= parent.max_depth - 1
 *   - Cascade revoke: revoking root kills entire subtree
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  initDb,
  createDelegatedKey,
  revokeDelegatedKey,
  getDelegationInfo,
} from '../../src/db/index';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getTestDb().prepare('DELETE FROM delegated_keys').run();
  getTestDb().prepare('DELETE FROM api_keys').run();
});

describe('Soma Delegation v0.1 — backward compat', () => {
  it('creates a depth-0 delegated key with default fields', () => {
    const { key: parent } = seedApiKey(getTestDb(), { credits: 5000 });
    const r = createDelegatedKey({ parentKey: parent, spendLimit: 100 });
    expect(r.ok).toBe(true);
    expect(r.childKey).toBeTruthy();

    const info = getDelegationInfo(r.childKey!);
    expect(info?.depth).toBe(0);
    expect(info?.max_depth).toBe(0);
    expect(info?.branch_spend_limit).toBeNull();
    expect(info?.intent_declaration).toBeNull();
  });

  it('rejects sub-delegation when parent max_depth=0 (legacy behavior)', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 5000 });
    const r1 = createDelegatedKey({ parentKey: root, spendLimit: 100 });
    expect(r1.ok).toBe(true);

    const r2 = createDelegatedKey({ parentKey: r1.childKey!, spendLimit: 10 });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/DEPTH_EXCEEDED/);
  });
});

describe('Soma Delegation v0.1 — depth chains', () => {
  it('allows 2-hop delegation when max_depth is set', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 5000 });
    const r1 = createDelegatedKey({
      parentKey: root,
      spendLimit: 1000,
      maxDepth: 2,
      branchSpendLimit: 100,
    });
    expect(r1.ok).toBe(true);

    const r2 = createDelegatedKey({
      parentKey: r1.childKey!,
      spendLimit: 50,
      maxDepth: 1,
    });
    expect(r2.ok).toBe(true);

    const info = getDelegationInfo(r2.childKey!);
    expect(info?.depth).toBe(1);
    expect(info?.max_depth).toBe(1);
  });

  it('rejects when child max_depth > parent.max_depth - 1', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 5000 });
    const r1 = createDelegatedKey({ parentKey: root, spendLimit: 1000, maxDepth: 2 });
    expect(r1.ok).toBe(true);

    // parent.max_depth=2 -> child.max_depth must be <= 1
    const r2 = createDelegatedKey({
      parentKey: r1.childKey!,
      spendLimit: 50,
      maxDepth: 5,
    });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/DEPTH_EXCEEDED/);
  });

  it('enforces branch_spend_limit', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 5000 });
    const r1 = createDelegatedKey({
      parentKey: root,
      spendLimit: 1000,
      maxDepth: 1,
      branchSpendLimit: 50,
    });
    expect(r1.ok).toBe(true);

    const r2 = createDelegatedKey({
      parentKey: r1.childKey!,
      spendLimit: 200, // > branchSpendLimit 50
    });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/BRANCH_CAP_EXCEEDED/);
  });
});

describe('Soma Delegation v0.1 — cascade revoke', () => {
  it('cascades revoke through a 3-level chain', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 10_000 });
    const r1 = createDelegatedKey({
      parentKey: root, spendLimit: 1000, maxDepth: 3, branchSpendLimit: 500,
    });
    expect(r1.ok).toBe(true);

    const r2 = createDelegatedKey({
      parentKey: r1.childKey!, spendLimit: 400, maxDepth: 2, branchSpendLimit: 200,
    });
    expect(r2.ok).toBe(true);

    const r3 = createDelegatedKey({
      parentKey: r2.childKey!, spendLimit: 100, maxDepth: 1,
    });
    expect(r3.ok).toBe(true);

    // Revoke the root delegation — grandchild + great-grandchild should die too.
    const rev = revokeDelegatedKey(root, r1.childKey!);
    expect(rev.ok).toBe(true);
    expect(rev.revokedCount).toBe(3);

    expect(getDelegationInfo(r1.childKey!)).toBeUndefined();
    expect(getDelegationInfo(r2.childKey!)).toBeUndefined();
    expect(getDelegationInfo(r3.childKey!)).toBeUndefined();
  });

  it('1-hop revoke is still a single revocation (no false cascade)', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    const r = createDelegatedKey({ parentKey: root, spendLimit: 100 });
    expect(r.ok).toBe(true);

    const rev = revokeDelegatedKey(root, r.childKey!);
    expect(rev.ok).toBe(true);
    expect(rev.revokedCount).toBe(1);
  });
});
