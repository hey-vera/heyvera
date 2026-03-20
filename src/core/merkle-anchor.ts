/**
 * Merkle tree construction and proof verification for attestation anchoring.
 *
 * Builds a binary Merkle tree from attestation hashes. The root is anchored
 * on Solana via a memo transaction so attestations become independently
 * verifiable on-chain even if the SQLite DB is lost.
 *
 * Tree layout: tree[0] = leaves, tree[1] = first pair hashes, ... tree[n] = [root].
 * Odd-length levels duplicate the last element before hashing.
 */

import { createHash } from 'crypto';

/**
 * SHA-256 hash two hex strings together (sorted order for determinism).
 */
function hashPair(a: string, b: string): string {
  // Consistent ordering: always hash the smaller value first
  const [left, right] = a < b ? [a, b] : [b, a];
  return createHash('sha256').update(left + right).digest('hex');
}

/**
 * Build a Merkle tree from an array of hex hash strings.
 * Returns { root, tree } where tree[0] = leaves, tree[last] = [root].
 * If input is empty, root is the hash of an empty string.
 */
export function buildMerkleTree(hashes: string[]): { root: string; tree: string[][] } {
  if (hashes.length === 0) {
    const emptyRoot = createHash('sha256').update('').digest('hex');
    return { root: emptyRoot, tree: [[emptyRoot]] };
  }

  if (hashes.length === 1) {
    return { root: hashes[0], tree: [hashes] };
  }

  // Sort leaves for deterministic ordering
  const leaves = [...hashes].sort();
  const tree: string[][] = [leaves];

  let currentLevel = leaves;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Odd element: duplicate it
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i]));
      }
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return { root: currentLevel[0], tree };
}

/**
 * Get the Merkle proof (sibling path) for a given hash within the tree.
 * Returns an array of sibling hashes from leaf to root.
 * Returns empty array if the hash is not found in the tree leaves.
 */
export function getMerkleProof(hash: string, tree: string[][]): string[] {
  if (tree.length === 0) return [];

  const leaves = tree[0];
  let index = leaves.indexOf(hash);

  if (index === -1) return [];

  const proof: string[] = [];

  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    if (siblingIndex < currentLevel.length) {
      proof.push(currentLevel[siblingIndex]);
    } else {
      // Odd level: sibling is a duplicate of self
      proof.push(currentLevel[index]);
    }

    // Move to parent index
    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Verify that a hash belongs to a Merkle tree with the given root, using the proof path.
 */
export function verifyMerkleProof(hash: string, proof: string[], root: string): boolean {
  if (proof.length === 0) {
    // Single-element tree or direct match
    return hash === root;
  }

  let current = hash;

  for (const sibling of proof) {
    current = hashPair(current, sibling);
  }

  return current === root;
}
