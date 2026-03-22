/**
 * Merkle tree construction and proof verification for attestation anchoring.
 *
 * Builds a binary Merkle tree from attestation hashes. The root is anchored
 * on Solana via a memo transaction so attestations become independently
 * verifiable on-chain even if the SQLite DB is lost.
 *
 * Tree layout: tree[0] = leaves, tree[1] = first pair hashes, ... tree[n] = [root].
 * Odd-length levels promote the last element to the next level without hashing
 * (prevents second-preimage attacks from naive leaf duplication).
 */

import { aidHash, AID_HASH_HEX_LENGTH } from '../utils/crypto-agility';

/**
 * Hash two hex strings together (sorted order for determinism).
 * Uses SHA-384 via crypto-agility module for quantum resistance.
 */
function hashPair(a: string, b: string): string {
  // Consistent ordering: always hash the smaller value first
  const [left, right] = a < b ? [a, b] : [b, a];
  return aidHash(left + right);
}

/**
 * Build a Merkle tree from an array of hex hash strings.
 * Returns { root, tree } where tree[0] = leaves, tree[last] = [root].
 * If input is empty, root is the hash of an empty string.
 *
 * Input hashes are deduplicated before building to prevent hash collision
 * issues in proof generation (indexOf would match the wrong leaf).
 *
 * Odd-length levels: the last element is promoted to the next level without
 * hashing, preventing second-preimage attacks from naive leaf duplication.
 */
export function buildMerkleTree(hashes: string[]): { root: string; tree: string[][] } {
  if (hashes.length === 0) {
    const emptyRoot = aidHash('');
    return { root: emptyRoot, tree: [[emptyRoot]] };
  }

  // Deduplicate input hashes to ensure indexOf uniqueness in proof generation
  const unique = [...new Set(hashes)];

  if (unique.length === 1) {
    return { root: unique[0], tree: [unique] };
  }

  // Sort leaves for deterministic ordering
  const leaves = unique.sort();
  const tree: string[][] = [leaves];

  let currentLevel = leaves;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Odd element: promote without hashing to prevent second-preimage attacks.
        // The element is carried to the next level as-is.
        nextLevel.push(currentLevel[i]);
      }
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return { root: currentLevel[0], tree };
}

/**
 * Get the Merkle proof (sibling path) for a given hash within the tree.
 * Returns an array of { sibling, promoted } entries from leaf to root.
 * `promoted` is true when the node had no real sibling (odd level) and was
 * carried up without hashing — the verifier must skip hashing for that step.
 *
 * Hashes in the tree are expected to be unique (buildMerkleTree deduplicates).
 * Returns null if the hash is not found in the tree leaves.
 */
export function getMerkleProof(
  hash: string,
  tree: string[][],
): { sibling: string; promoted: boolean }[] | null {
  if (tree.length === 0) return null;

  const leaves = tree[0];
  let index = leaves.indexOf(hash);

  if (index === -1) return null;

  const proof: { sibling: string; promoted: boolean }[] = [];

  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    if (siblingIndex < currentLevel.length) {
      proof.push({ sibling: currentLevel[siblingIndex], promoted: false });
    } else {
      // Odd level: this node was promoted without hashing — no real sibling
      proof.push({ sibling: currentLevel[index], promoted: true });
    }

    // Move to parent index
    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Verify that a hash belongs to a Merkle tree with the given root, using the proof path.
 * Proof entries marked `promoted: true` are skipped (node was carried up without hashing).
 */
export function verifyMerkleProof(
  hash: string,
  proof: { sibling: string; promoted: boolean }[],
  root: string,
): boolean {
  if (proof.length === 0) {
    // Single-element tree or direct match
    return hash === root;
  }

  let current = hash;

  for (const step of proof) {
    if (step.promoted) {
      // Node was promoted without hashing — current stays the same
      continue;
    }
    current = hashPair(current, step.sibling);
  }

  return current === root;
}

/**
 * Validate that a parsed tree_json has a valid Merkle tree structure.
 * Checks:
 *  - Each level is approximately ceil(previous / 2) in length
 *  - Root (last level) has exactly 1 element
 *  - All elements are hex strings of the expected SHA-256 length (64 chars)
 */
export function validateTreeStructure(tree: string[][]): { valid: boolean; error?: string } {
  if (!Array.isArray(tree) || tree.length === 0) {
    return { valid: false, error: 'Tree must be a non-empty array of levels' };
  }

  for (let level = 0; level < tree.length; level++) {
    const levelArr = tree[level];
    if (!Array.isArray(levelArr) || levelArr.length === 0) {
      return { valid: false, error: `Level ${level} must be a non-empty array` };
    }

    // Validate all elements are hex strings of expected length
    for (let i = 0; i < levelArr.length; i++) {
      const elem = levelArr[i];
      // Accept both SHA-256 (64 hex) and SHA-384 (96 hex) for backwards compatibility
      if (typeof elem !== 'string' || !/^[0-9a-f]+$/.test(elem) || (elem.length !== 64 && elem.length !== AID_HASH_HEX_LENGTH)) {
        return { valid: false, error: `Level ${level}[${i}] is not a valid hex hash string` };
      }
    }

    // Check level size relationship (skip for the first level — leaves)
    if (level > 0) {
      const prevLength = tree[level - 1].length;
      const expectedLength = Math.ceil(prevLength / 2);
      if (levelArr.length !== expectedLength) {
        return {
          valid: false,
          error: `Level ${level} has ${levelArr.length} elements, expected ${expectedLength} (ceil(${prevLength}/2))`,
        };
      }
    }
  }

  // Root must be a single element
  const rootLevel = tree[tree.length - 1];
  if (rootLevel.length !== 1) {
    return { valid: false, error: `Root level has ${rootLevel.length} elements, expected 1` };
  }

  return { valid: true };
}
