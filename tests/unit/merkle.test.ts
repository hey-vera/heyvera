/**
 * Unit tests — Merkle tree construction, proof generation, and verification
 *
 * Tests the security-critical Merkle tree functions used for attestation anchoring:
 * - buildMerkleTree: tree construction from hash arrays
 * - getMerkleProof: proof path generation for individual leaves
 * - verifyMerkleProof: proof verification against a root
 * - validateTreeStructure: structural validation of serialized trees
 */
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMerkleTree,
  getMerkleProof,
  verifyMerkleProof,
  validateTreeStructure,
} from '../../src/core/merkle-anchor';

/** Helper: produce a SHA-256 hex string from arbitrary input */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Generate N unique hashes for testing */
function makeHashes(n: number): string[] {
  return Array.from({ length: n }, (_, i) => sha256(`leaf-${i}`));
}

// ─── buildMerkleTree ─────────────────────────────────────────────────────────

describe('buildMerkleTree', () => {
  it('handles empty array — root is hash of empty string', () => {
    const { root, tree } = buildMerkleTree([]);
    const expected = createHash('sha256').update('').digest('hex');
    expect(root).toBe(expected);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toEqual([expected]);
  });

  it('single hash — root equals the input hash', () => {
    const h = sha256('only-leaf');
    const { root, tree } = buildMerkleTree([h]);
    expect(root).toBe(h);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toEqual([h]);
  });

  it('two hashes — one level of pairing', () => {
    const hashes = makeHashes(2);
    const { root, tree } = buildMerkleTree(hashes);
    // tree: [leaves, [root]]
    expect(tree).toHaveLength(2);
    expect(tree[0]).toHaveLength(2);
    expect(tree[1]).toHaveLength(1);
    expect(root).toBe(tree[1][0]);
  });

  it('three hashes — odd leaf promoted without duplication', () => {
    const hashes = makeHashes(3);
    const { root, tree } = buildMerkleTree(hashes);
    // Level 0: 3 leaves → Level 1: 2 nodes (one pair + one promoted) → Level 2: 1 root
    expect(tree[0]).toHaveLength(3);
    expect(tree[1]).toHaveLength(2);
    expect(tree[2]).toHaveLength(1);
    expect(root).toBe(tree[2][0]);
  });

  it('four hashes — balanced binary tree', () => {
    const hashes = makeHashes(4);
    const { root, tree } = buildMerkleTree(hashes);
    expect(tree[0]).toHaveLength(4);
    expect(tree[1]).toHaveLength(2);
    expect(tree[2]).toHaveLength(1);
    expect(root).toBe(tree[2][0]);
  });

  it('seven hashes — multiple levels with odd promotion', () => {
    const hashes = makeHashes(7);
    const { root, tree } = buildMerkleTree(hashes);
    expect(tree[0]).toHaveLength(7);
    expect(tree[1]).toHaveLength(4); // ceil(7/2) = 4
    expect(tree[2]).toHaveLength(2); // ceil(4/2) = 2
    expect(tree[3]).toHaveLength(1); // root
    expect(root).toBe(tree[3][0]);
  });

  it('100 hashes — produces valid multi-level tree', () => {
    const hashes = makeHashes(100);
    const { root, tree } = buildMerkleTree(hashes);
    expect(root).toHaveLength(64); // SHA-256 hex
    // Last level must be the root (single element)
    expect(tree[tree.length - 1]).toHaveLength(1);
    expect(tree[tree.length - 1][0]).toBe(root);
    // Each level should be ceil(previous/2)
    for (let i = 1; i < tree.length; i++) {
      expect(tree[i]).toHaveLength(Math.ceil(tree[i - 1].length / 2));
    }
  });

  it('deduplicates identical hashes', () => {
    const h = sha256('duplicate');
    const { root, tree } = buildMerkleTree([h, h, h]);
    // After dedup, only 1 unique hash — root equals that hash
    expect(root).toBe(h);
    expect(tree[0]).toHaveLength(1);
  });

  it('root is deterministic — same input produces same root', () => {
    const hashes = makeHashes(10);
    const result1 = buildMerkleTree(hashes);
    const result2 = buildMerkleTree([...hashes]); // fresh copy
    expect(result1.root).toBe(result2.root);
  });

  it('root is deterministic regardless of input order', () => {
    const hashes = makeHashes(5);
    const reversed = [...hashes].reverse();
    // buildMerkleTree sorts leaves, so order should not matter
    expect(buildMerkleTree(hashes).root).toBe(buildMerkleTree(reversed).root);
  });
});

// ─── getMerkleProof ──────────────────────────────────────────────────────────

describe('getMerkleProof', () => {
  it('returns valid proof for each leaf in a 4-leaf tree', () => {
    const hashes = makeHashes(4);
    const { root, tree } = buildMerkleTree(hashes);

    for (const leaf of tree[0]) {
      const proof = getMerkleProof(leaf, tree);
      expect(proof).not.toBeNull();
      expect(verifyMerkleProof(leaf, proof!, root)).toBe(true);
    }
  });

  it('returns valid proof for each leaf in a 7-leaf tree (odd levels)', () => {
    const hashes = makeHashes(7);
    const { root, tree } = buildMerkleTree(hashes);

    for (const leaf of tree[0]) {
      const proof = getMerkleProof(leaf, tree);
      expect(proof).not.toBeNull();
      expect(verifyMerkleProof(leaf, proof!, root)).toBe(true);
    }
  });

  it('returns valid proof for each leaf in a 100-leaf tree', () => {
    const hashes = makeHashes(100);
    const { root, tree } = buildMerkleTree(hashes);

    for (const leaf of tree[0]) {
      const proof = getMerkleProof(leaf, tree);
      expect(proof).not.toBeNull();
      expect(verifyMerkleProof(leaf, proof!, root)).toBe(true);
    }
  });

  it('returns null for a hash not in the tree', () => {
    const hashes = makeHashes(4);
    const { tree } = buildMerkleTree(hashes);
    const missing = sha256('not-in-tree');
    expect(getMerkleProof(missing, tree)).toBeNull();
  });

  it('returns null for empty tree', () => {
    expect(getMerkleProof(sha256('x'), [])).toBeNull();
  });

  it('returns empty proof for a single-element tree', () => {
    const h = sha256('solo');
    const { root, tree } = buildMerkleTree([h]);
    const proof = getMerkleProof(h, tree);
    expect(proof).not.toBeNull();
    expect(proof).toHaveLength(0);
    // Empty proof means hash === root
    expect(verifyMerkleProof(h, proof!, root)).toBe(true);
  });
});

// ─── verifyMerkleProof ───────────────────────────────────────────────────────

describe('verifyMerkleProof', () => {
  it('succeeds for valid proofs', () => {
    const hashes = makeHashes(8);
    const { root, tree } = buildMerkleTree(hashes);
    const leaf = tree[0][0];
    const proof = getMerkleProof(leaf, tree)!;
    expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
  });

  it('fails when proof is tampered — one byte changed in sibling', () => {
    const hashes = makeHashes(8);
    const { root, tree } = buildMerkleTree(hashes);
    const leaf = tree[0][0];
    const proof = getMerkleProof(leaf, tree)!;

    // Tamper: change the first character of the first sibling
    const tampered = proof.map((step, i) => {
      if (i === 0) {
        const badSibling = (step.sibling[0] === 'a' ? 'b' : 'a') + step.sibling.slice(1);
        return { ...step, sibling: badSibling };
      }
      return step;
    });

    expect(verifyMerkleProof(leaf, tampered, root)).toBe(false);
  });

  it('fails for wrong root', () => {
    const hashes = makeHashes(8);
    const { tree } = buildMerkleTree(hashes);
    const leaf = tree[0][0];
    const proof = getMerkleProof(leaf, tree)!;
    const wrongRoot = sha256('wrong-root');
    expect(verifyMerkleProof(leaf, proof, wrongRoot)).toBe(false);
  });

  it('fails for wrong leaf hash', () => {
    const hashes = makeHashes(8);
    const { root, tree } = buildMerkleTree(hashes);
    const leaf = tree[0][0];
    const proof = getMerkleProof(leaf, tree)!;
    const wrongLeaf = sha256('wrong-leaf');
    expect(verifyMerkleProof(wrongLeaf, proof, root)).toBe(false);
  });

  it('single-element tree: hash === root with empty proof', () => {
    const h = sha256('single');
    expect(verifyMerkleProof(h, [], h)).toBe(true);
  });

  it('single-element tree: wrong hash fails', () => {
    const h = sha256('single');
    expect(verifyMerkleProof(sha256('other'), [], h)).toBe(false);
  });
});

// ─── validateTreeStructure ───────────────────────────────────────────────────

describe('validateTreeStructure', () => {
  it('accepts a valid 4-leaf tree', () => {
    const { tree } = buildMerkleTree(makeHashes(4));
    expect(validateTreeStructure(tree)).toEqual({ valid: true });
  });

  it('accepts a valid 7-leaf tree (odd levels)', () => {
    const { tree } = buildMerkleTree(makeHashes(7));
    expect(validateTreeStructure(tree)).toEqual({ valid: true });
  });

  it('accepts a valid 100-leaf tree', () => {
    const { tree } = buildMerkleTree(makeHashes(100));
    expect(validateTreeStructure(tree)).toEqual({ valid: true });
  });

  it('accepts a single-element tree', () => {
    const { tree } = buildMerkleTree([sha256('one')]);
    expect(validateTreeStructure(tree)).toEqual({ valid: true });
  });

  it('rejects empty array', () => {
    const result = validateTreeStructure([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('rejects non-array input', () => {
    const result = validateTreeStructure('not-an-array' as unknown as string[][]);
    expect(result.valid).toBe(false);
  });

  it('rejects tree with empty level', () => {
    const result = validateTreeStructure([[]]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('rejects tree with non-hex strings', () => {
    const result = validateTreeStructure([['not-a-valid-hex']]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('hex string');
  });

  it('rejects tree with wrong-length hex strings', () => {
    const result = validateTreeStructure([['abcdef0123456789']]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64-char hex');
  });

  it('rejects tree with uppercase hex', () => {
    const upper = sha256('test').toUpperCase();
    const result = validateTreeStructure([[upper]]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('hex string');
  });

  it('rejects tree with incorrect level sizes', () => {
    const h = makeHashes(4);
    // Valid leaves but wrong next level size (should be 2, not 3)
    const badTree = [h, [sha256('a'), sha256('b'), sha256('c')]];
    const result = validateTreeStructure(badTree);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected');
  });

  it('rejects tree where root level has more than 1 element', () => {
    // Manually construct a malformed tree: root has 2 elements
    const h = makeHashes(4);
    const level1 = [sha256('p1'), sha256('p2')];
    const badTree = [h, level1]; // root level has 2 — invalid
    const result = validateTreeStructure(badTree);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Root level');
  });
});

// ─── Odd leaf handling ───────────────────────────────────────────────────────

describe('odd leaf handling (promotion, not duplication)', () => {
  it('promoted leaf proof contains a promoted step', () => {
    const hashes = makeHashes(3);
    const { tree } = buildMerkleTree(hashes);
    // The 3rd leaf (index 2) at level 0 should be promoted
    const lastLeaf = tree[0][2];
    const proof = getMerkleProof(lastLeaf, tree);
    expect(proof).not.toBeNull();
    // At least one step should be marked as promoted
    const hasPromoted = proof!.some(step => step.promoted);
    expect(hasPromoted).toBe(true);
  });

  it('5 leaves: all proofs verify correctly', () => {
    const hashes = makeHashes(5);
    const { root, tree } = buildMerkleTree(hashes);
    for (const leaf of tree[0]) {
      const proof = getMerkleProof(leaf, tree)!;
      expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
    }
  });

  it('13 leaves: all proofs verify correctly', () => {
    const hashes = makeHashes(13);
    const { root, tree } = buildMerkleTree(hashes);
    for (const leaf of tree[0]) {
      const proof = getMerkleProof(leaf, tree)!;
      expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
    }
  });
});
