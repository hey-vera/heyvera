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
  getDelegationChain,
} from '../../src/db/index';
import { buildDelegationChainHeaders } from '../../src/utils/billing';

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

describe('Soma Delegation v0.1 — chain walk', () => {
  it('returns empty chain for a non-delegated (root) key', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    expect(getDelegationChain(root)).toEqual([]);
  });

  it('returns single-entry chain for depth-0 child', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    const r = createDelegatedKey({ parentKey: root, spendLimit: 100 });
    const chain = getDelegationChain(r.childKey!);
    expect(chain.length).toBe(1);
    expect(chain[0].child_key).toBe(r.childKey);
    expect(chain[0].parent_key).toBe(root);
    expect(chain[0].depth).toBe(0);
  });

  it('returns full chain leaf→root for a 3-hop delegation', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 10_000 });
    const r1 = createDelegatedKey({ parentKey: root, spendLimit: 1000, maxDepth: 3, branchSpendLimit: 500 });
    const r2 = createDelegatedKey({ parentKey: r1.childKey!, spendLimit: 400, maxDepth: 2, branchSpendLimit: 200 });
    const r3 = createDelegatedKey({ parentKey: r2.childKey!, spendLimit: 100, maxDepth: 1 });

    const chain = getDelegationChain(r3.childKey!);
    expect(chain.length).toBe(3);
    // Leaf first
    expect(chain[0].child_key).toBe(r3.childKey);
    expect(chain[0].parent_key).toBe(r2.childKey);
    expect(chain[0].depth).toBe(2);
    // Middle
    expect(chain[1].child_key).toBe(r2.childKey);
    expect(chain[1].parent_key).toBe(r1.childKey);
    expect(chain[1].depth).toBe(1);
    // Root-adjacent
    expect(chain[2].child_key).toBe(r1.childKey);
    expect(chain[2].parent_key).toBe(root);
    expect(chain[2].depth).toBe(0);
  });

  it('includes revoked entries so parents can audit historical chains', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    const r = createDelegatedKey({ parentKey: root, spendLimit: 100 });
    revokeDelegatedKey(root, r.childKey!);

    const chain = getDelegationChain(r.childKey!);
    expect(chain.length).toBe(1);
    expect(chain[0].active).toBe(0);
    expect(chain[0].revoked_at).not.toBeNull();
  });
});

describe('Soma Delegation v0.1 — chain response headers', () => {
  it('returns null when no delegated key is in use', () => {
    expect(buildDelegationChainHeaders(undefined)).toBeNull();
  });

  it('returns null when key is not a delegation child', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    // root is a plain api key, not a delegation child
    expect(buildDelegationChainHeaders(root)).toBeNull();
  });

  it('returns masked single-hop headers for a depth-0 child', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 1000 });
    const r = createDelegatedKey({
      parentKey: root,
      spendLimit: 100,
      intentDeclaration: 'research: summarize DeFi TVL',
    });
    const headers = buildDelegationChainHeaders(r.childKey!);
    expect(headers).not.toBeNull();
    expect(headers!['X-Soma-Delegation-Depth']).toBe('0');
    expect(headers!['X-Soma-Delegation-Hops']).toBe('1');
    expect(headers!['X-Soma-Delegation-Intent']).toBe('research: summarize DeFi TVL');
    // Chain should contain one masked leaf key
    expect(headers!['X-Soma-Delegation-Chain']).toMatch(/^.{4}••••.{4}$/);
    // Root should mask the original API key (not the child)
    expect(headers!['X-Soma-Delegation-Root']).toMatch(/^.{4}••••.{4}$/);
    expect(headers!['X-Soma-Delegation-Root']).not.toBe(headers!['X-Soma-Delegation-Chain']);
  });

  it('returns full leaf→root chain for a 3-hop delegation', () => {
    const { key: root } = seedApiKey(getTestDb(), { credits: 10_000 });
    const r1 = createDelegatedKey({ parentKey: root, spendLimit: 1000, maxDepth: 3, branchSpendLimit: 500 });
    const r2 = createDelegatedKey({ parentKey: r1.childKey!, spendLimit: 400, maxDepth: 2, branchSpendLimit: 200 });
    const r3 = createDelegatedKey({ parentKey: r2.childKey!, spendLimit: 100, maxDepth: 1 });

    const headers = buildDelegationChainHeaders(r3.childKey!);
    expect(headers).not.toBeNull();
    expect(headers!['X-Soma-Delegation-Depth']).toBe('2');
    expect(headers!['X-Soma-Delegation-Hops']).toBe('3');
    // Chain should be leaf first, 3 comma-separated masked keys
    const chainParts = headers!['X-Soma-Delegation-Chain'].split(',');
    expect(chainParts.length).toBe(3);
    // No intent set → header should be absent
    expect(headers!['X-Soma-Delegation-Intent']).toBeUndefined();
  });
});
