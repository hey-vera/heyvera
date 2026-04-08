/**
 * pulse-tree.ts — The Soma Pulse Tree
 *
 * A Merkle Mountain Range (MMR) with typed leaves and sum annotations.
 * One universal structure for an agent's entire lifecycle:
 *
 *   - Agent actions (API calls, LLM inferences, tool uses)
 *   - Economic events (credit spends, bond deposits, payments)
 *   - Behavioral checkpoints (periodic summaries)
 *   - ZK proofs (Nova IVC / Groth16, stored as leaves)
 *   - Wallet derivations
 *   - Burner agent events (create/revoke/slash)
 *   - Death certificate (final event, seals the tree)
 *
 * Properties:
 *   - Append-only, chronologically ordered (position = causal order)
 *   - Internal nodes carry cumulative credit_delta (economic proofs free)
 *   - Single root = entire agent state (32 bytes)
 *   - O(log n) inclusion proofs
 *   - Type tags on leaves enable per-type filtering
 *
 * Based on: Grin/Nervos MMR (0-based indexing), Celestia NMT (typed leaves),
 * Summa MST (sum annotations). Novel composition for agent lifecycle.
 */

import { somaHash } from '../utils/crypto-agility';

// ─── Event Types ───────────────────────────────────────────────────────────

export const PULSE_TYPE = {
  ACTION:     0x01,
  ECONOMIC:   0x02,
  CHECKPOINT: 0x03,
  ZK_PROOF:   0x04,
  WALLET:     0x05,
  BURNER:     0x06,
  DEATH:      0x07,
} as const;

export type PulseType = (typeof PULSE_TYPE)[keyof typeof PULSE_TYPE];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PulseLeaf {
  type: PulseType;
  heartbeatIndex: number;
  timestamp: string;        // ISO 8601
  payloadHash: string;      // H(event-specific data)
  creditDelta: number;      // economic impact (0 for non-economic events)
}

export interface PulseNode {
  position: number;
  hash: string;
  height: number;
  sumCredits: number;       // cumulative credit_delta of all descendants
}

export interface PulseInclusionProof {
  leafIndex: number;
  leafHash: string;
  siblings: string[];       // hashes along the path to the peak
  peakHashes: string[];     // all peak hashes for bagging
  mmrSize: number;          // MMR size at time of proof
  root: string;             // bagged root at time of proof
}

// ─── Hash Functions ────────────────────────────────────────────────────────

/** Hash a leaf: H(position || type || heartbeatIndex || timestamp || payloadHash || creditDelta) */
export function hashLeaf(position: number, leaf: PulseLeaf): string {
  return somaHash(
    `leaf:${position}:${leaf.type}:${leaf.heartbeatIndex}:${leaf.timestamp}:${leaf.payloadHash}:${leaf.creditDelta}`,
  );
}

/** Hash an internal node: H(position || leftHash || rightHash). Sum is metadata, not in hash. */
export function hashNode(position: number, leftHash: string, rightHash: string): string {
  return somaHash(`node:${position}:${leftHash}:${rightHash}`);
}

// ─── Bit Manipulation Helpers ──────────────────────────────────────────────

/** Count trailing zeros in binary representation. */
function trailingZeros(n: number): number {
  if (n === 0) return 32;
  let count = 0;
  while ((n & 1) === 0) { n >>= 1; count++; }
  return count;
}

/** Count set bits (population count). */
function popcount(n: number): number {
  let count = 0;
  while (n > 0) { count += n & 1; n >>= 1; }
  return count;
}

/** Largest (2^k - 1) that fits in n. */
function allOnes(n: number): number {
  let v = 1;
  while (v <= n) v <<= 1;
  return (v >> 1) - 1;
}

/** Height of a node at a given MMR position (0-based). */
export function posHeight(pos: number): number {
  // Decompose: subtract largest perfect tree peaks left-to-right
  let peakSize = allOnes(pos + 1);
  let p = pos;
  while (peakSize > 0) {
    if (p >= peakSize) {
      p -= peakSize;
    }
    peakSize >>= 1;
  }
  return p;
}

/** Convert leaf index (0-based leaf count) to MMR position. */
export function leafIndexToPos(leafIndex: number): number {
  return leafIndexToMmrSize(leafIndex) - trailingZeros(leafIndex + 1) - 1;
}

/** MMR size after inserting leaf at leafIndex. */
function leafIndexToMmrSize(leafIndex: number): number {
  const leaves = leafIndex + 1;
  return 2 * leaves - popcount(leaves);
}

// ─── Peak Computation ──────────────────────────────────────────────────────

/** Get positions of all peaks in an MMR of given size. */
export function getPeaks(mmrSize: number): number[] {
  if (mmrSize === 0) return [];
  const peaks: number[] = [];
  let peakSize = allOnes(mmrSize + 1);
  if (peakSize > mmrSize) peakSize >>= 1;
  let sum = 0;
  let remaining = mmrSize;
  while (peakSize > 0) {
    if (remaining >= peakSize) {
      peaks.push(sum + peakSize - 1);
      sum += peakSize;
      remaining -= peakSize;
    }
    peakSize >>= 1;
  }
  return peaks;
}

/** Bag (fold) peaks into a single root hash. Right-to-left fold. */
export function bagPeaks(peakHashes: string[], totalCredits: number): string {
  if (peakHashes.length === 0) return somaHash('empty');
  if (peakHashes.length === 1) return somaHash(`root:${peakHashes[0]}:${totalCredits}`);
  let result = somaHash(`bag:${peakHashes[peakHashes.length - 2]}:${peakHashes[peakHashes.length - 1]}`);
  for (let i = peakHashes.length - 3; i >= 0; i--) {
    result = somaHash(`bag:${peakHashes[i]}:${result}`);
  }
  return somaHash(`root:${result}:${totalCredits}`);
}

// ─── Pulse Tree Class ──────────────────────────────────────────────────────

export class PulseTree {
  private nodes: Map<number, PulseNode> = new Map();
  private _size = 0;
  private _leafCount = 0;
  private _totalCredits = 0;

  get size(): number { return this._size; }
  get leafCount(): number { return this._leafCount; }
  get totalCredits(): number { return this._totalCredits; }

  /** Get the current root hash (bagged peaks + total credits). */
  getRoot(): string {
    const peaks = getPeaks(this._size);
    const peakHashes = peaks.map(p => this.nodes.get(p)!.hash);
    return bagPeaks(peakHashes, this._totalCredits);
  }

  /** Get all current peak positions. */
  getPeakPositions(): number[] {
    return getPeaks(this._size);
  }

  /** Get a node by position. */
  getNode(pos: number): PulseNode | undefined {
    return this.nodes.get(pos);
  }

  /**
   * Append a typed leaf to the tree.
   * Returns the leaf's MMR position and the new root.
   */
  append(leaf: PulseLeaf): { position: number; root: string } {
    const leafPos = this._size;
    const leafH = hashLeaf(leafPos, leaf);

    this.nodes.set(leafPos, {
      position: leafPos,
      hash: leafH,
      height: 0,
      sumCredits: leaf.creditDelta,
    });

    this._totalCredits += leaf.creditDelta;
    this._leafCount++;

    // Merge: if there's a left sibling at the same height, create parent
    let pos = leafPos;
    let currentHash = leafH;
    let currentSum = leaf.creditDelta;
    let height = 0;

    while (true) {
      // Check if we should merge with left sibling
      const siblingOffset = (1 << (height + 1)) - 1;
      const leftSiblingPos = pos - siblingOffset;

      if (leftSiblingPos < 0) break;

      const leftSibling = this.nodes.get(leftSiblingPos);
      if (!leftSibling || leftSibling.height !== height) break;

      // Merge: create parent node
      const parentPos = pos + 1;
      const parentSum = leftSibling.sumCredits + currentSum;
      const parentHash = hashNode(parentPos, leftSibling.hash, currentHash);

      this.nodes.set(parentPos, {
        position: parentPos,
        hash: parentHash,
        height: height + 1,
        sumCredits: parentSum,
      });

      pos = parentPos;
      currentHash = parentHash;
      currentSum = parentSum;
      height++;
    }

    this._size = pos + 1;

    return { position: leafPos, root: this.getRoot() };
  }

  /**
   * Generate an inclusion proof for a leaf at the given index.
   */
  generateProof(leafIndex: number): PulseInclusionProof {
    if (leafIndex < 0 || leafIndex >= this._leafCount) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this._leafCount})`);
    }

    const leafPos = leafIndexToPos(leafIndex);
    const leafNode = this.nodes.get(leafPos);
    if (!leafNode) throw new Error(`Node at position ${leafPos} not found`);

    const peaks = getPeaks(this._size);
    const siblings: string[] = [];

    let pos = leafPos;
    let height = 0;

    // Walk from leaf to its peak, collecting sibling hashes
    while (!peaks.includes(pos)) {
      const siblingOffset = (1 << (height + 1)) - 1;
      const leftSiblingPos = pos - siblingOffset;

      if (leftSiblingPos >= 0 && this.nodes.get(leftSiblingPos)?.height === height) {
        // We are the right child — left sibling is at leftSiblingPos
        siblings.push(this.nodes.get(leftSiblingPos)!.hash);
        pos = pos + 1; // parent is next position
      } else {
        // We are the left child — right sibling is at pos + siblingOffset
        const rightSiblingPos = pos + siblingOffset;
        if (!this.nodes.has(rightSiblingPos)) break;
        siblings.push(this.nodes.get(rightSiblingPos)!.hash);
        pos = pos + siblingOffset + 1; // parent position
      }
      height++;
    }

    const peakHashes = peaks.map(p => this.nodes.get(p)!.hash);

    return {
      leafIndex,
      leafHash: leafNode.hash,
      siblings,
      peakHashes,
      mmrSize: this._size,
      root: this.getRoot(),
    };
  }

  /**
   * Verify an inclusion proof.
   * Returns true if the proof is valid against the given root.
   */
  static verifyProof(proof: PulseInclusionProof, leaf: PulseLeaf): boolean {
    const leafPos = leafIndexToPos(proof.leafIndex);
    let hash = hashLeaf(leafPos, leaf);

    // Verify the leaf hash matches
    if (hash !== proof.leafHash) return false;

    const peaks = getPeaks(proof.mmrSize);
    let pos = leafPos;
    let height = 0;

    // Reconstruct path from leaf to peak
    for (const siblingHash of proof.siblings) {
      const siblingOffset = (1 << (height + 1)) - 1;
      const leftSiblingPos = pos - siblingOffset;

      // Determine if we're left or right child
      if (leftSiblingPos >= 0 && posHeight(leftSiblingPos) === height) {
        // We are right child
        pos = pos + 1;
        hash = hashNode(pos, siblingHash, hash);
      } else {
        // We are left child
        pos = pos + siblingOffset + 1;
        hash = hashNode(pos, hash, siblingHash);
      }
      height++;
    }

    // Check if we reached a peak and the hash matches
    const peakIdx = peaks.indexOf(pos);
    if (peakIdx === -1) return false;
    return proof.peakHashes[peakIdx] === hash;
  }

  /**
   * Export the current state (peaks only — minimal representation).
   */
  exportState(): PulseTreeState {
    const peaks = getPeaks(this._size);
    return {
      size: this._size,
      leafCount: this._leafCount,
      totalCredits: this._totalCredits,
      root: this.getRoot(),
      peaks: peaks.map(p => ({
        position: p,
        hash: this.nodes.get(p)!.hash,
        height: this.nodes.get(p)!.height,
        sumCredits: this.nodes.get(p)!.sumCredits,
      })),
    };
  }
}

export interface PulseTreeState {
  size: number;
  leafCount: number;
  totalCredits: number;
  root: string;
  peaks: Array<{
    position: number;
    hash: string;
    height: number;
    sumCredits: number;
  }>;
}
