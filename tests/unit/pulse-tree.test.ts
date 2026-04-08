/**
 * Pulse Tree Tests — MMR with typed leaves and sum annotations
 */
import { describe, it, expect } from 'vitest';
import {
  PulseTree,
  PULSE_TYPE,
  PulseLeaf,
  hashLeaf,
  hashNode,
  posHeight,
  leafIndexToPos,
  getPeaks,
  bagPeaks,
} from '../../src/core/pulse-tree';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeLeaf(type: number, heartbeat: number, creditDelta = 0): PulseLeaf {
  return {
    type: type as any,
    heartbeatIndex: heartbeat,
    timestamp: new Date().toISOString(),
    payloadHash: `payload-${heartbeat}`,
    creditDelta,
  };
}

// ─── Position Math ─────────────────────────────────────────────────────────

describe('MMR position math', () => {
  it('posHeight returns correct heights', () => {
    // For 4 leaves, positions: 0(h0) 1(h0) 2(h1) 3(h0) 4(h0) 5(h1) 6(h2)
    expect(posHeight(0)).toBe(0);
    expect(posHeight(1)).toBe(0);
    expect(posHeight(2)).toBe(1);
    expect(posHeight(3)).toBe(0);
    expect(posHeight(4)).toBe(0);
    expect(posHeight(5)).toBe(1);
    expect(posHeight(6)).toBe(2);
  });

  it('leafIndexToPos maps correctly', () => {
    expect(leafIndexToPos(0)).toBe(0);  // 1st leaf at position 0
    expect(leafIndexToPos(1)).toBe(1);  // 2nd leaf at position 1
    expect(leafIndexToPos(2)).toBe(3);  // 3rd leaf at position 3
    expect(leafIndexToPos(3)).toBe(4);  // 4th leaf at position 4
    expect(leafIndexToPos(4)).toBe(7);  // 5th leaf at position 7
  });

  it('getPeaks returns correct peaks', () => {
    // After 1 leaf: size=1, peaks=[0]
    expect(getPeaks(1)).toEqual([0]);
    // After 2 leaves: size=3, peaks=[2] (merged)
    expect(getPeaks(3)).toEqual([2]);
    // After 3 leaves: size=4, peaks=[2, 3]
    expect(getPeaks(4)).toEqual([2, 3]);
    // After 4 leaves: size=7, peaks=[6]
    expect(getPeaks(7)).toEqual([6]);
    // After 5 leaves: size=8, peaks=[6, 7]
    expect(getPeaks(8)).toEqual([6, 7]);
  });
});

// ─── Core Append ───────────────────────────────────────────────────────────

describe('Pulse Tree append', () => {
  it('appends a single leaf', () => {
    const tree = new PulseTree();
    const leaf = makeLeaf(PULSE_TYPE.ACTION, 0);
    const { position, root } = tree.append(leaf);

    expect(position).toBe(0);
    expect(root).toBeDefined();
    expect(tree.leafCount).toBe(1);
    expect(tree.size).toBe(1);
  });

  it('appends two leaves and merges', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 0));
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 1));

    expect(tree.leafCount).toBe(2);
    expect(tree.size).toBe(3); // 2 leaves + 1 parent
    expect(getPeaks(tree.size)).toEqual([2]); // single peak
  });

  it('three leaves: two peaks', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 0));
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 1));
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 2));

    expect(tree.leafCount).toBe(3);
    expect(tree.size).toBe(4); // 3 leaves + 1 parent (first two merged)
    expect(getPeaks(tree.size)).toEqual([2, 3]);
  });

  it('four leaves: single peak at height 2', () => {
    const tree = new PulseTree();
    for (let i = 0; i < 4; i++) tree.append(makeLeaf(PULSE_TYPE.ACTION, i));

    expect(tree.leafCount).toBe(4);
    expect(tree.size).toBe(7);
    expect(getPeaks(tree.size)).toEqual([6]);
  });

  it('root is deterministic for same inputs', () => {
    const makeTree = () => {
      const t = new PulseTree();
      const ts = '2026-04-07T00:00:00.000Z';
      t.append({ type: PULSE_TYPE.ACTION, heartbeatIndex: 0, timestamp: ts, payloadHash: 'a', creditDelta: 0 });
      t.append({ type: PULSE_TYPE.ECONOMIC, heartbeatIndex: 1, timestamp: ts, payloadHash: 'b', creditDelta: 5 });
      return t;
    };
    expect(makeTree().getRoot()).toBe(makeTree().getRoot());
  });

  it('different inputs produce different roots', () => {
    const t1 = new PulseTree();
    const t2 = new PulseTree();
    const ts = '2026-04-07T00:00:00.000Z';
    t1.append({ type: PULSE_TYPE.ACTION, heartbeatIndex: 0, timestamp: ts, payloadHash: 'a', creditDelta: 0 });
    t2.append({ type: PULSE_TYPE.ACTION, heartbeatIndex: 0, timestamp: ts, payloadHash: 'b', creditDelta: 0 });
    expect(t1.getRoot()).not.toBe(t2.getRoot());
  });
});

// ─── Typed Leaves ──────────────────────────────────────────────────────────

describe('Pulse Tree typed leaves', () => {
  it('accepts all seven event types', () => {
    const tree = new PulseTree();
    const types = [
      PULSE_TYPE.ACTION,
      PULSE_TYPE.ECONOMIC,
      PULSE_TYPE.CHECKPOINT,
      PULSE_TYPE.ZK_PROOF,
      PULSE_TYPE.WALLET,
      PULSE_TYPE.BURNER,
      PULSE_TYPE.DEATH,
    ];

    for (let i = 0; i < types.length; i++) {
      tree.append(makeLeaf(types[i], i));
    }

    expect(tree.leafCount).toBe(7);
    expect(tree.getRoot()).toBeDefined();
  });

  it('different types with same payload produce different hashes', () => {
    const ts = '2026-04-07T00:00:00.000Z';
    const h1 = hashLeaf(0, { type: PULSE_TYPE.ACTION, heartbeatIndex: 0, timestamp: ts, payloadHash: 'x', creditDelta: 0 });
    const h2 = hashLeaf(0, { type: PULSE_TYPE.ECONOMIC, heartbeatIndex: 0, timestamp: ts, payloadHash: 'x', creditDelta: 0 });
    expect(h1).not.toBe(h2);
  });
});

// ─── Sum Annotations ───────────────────────────────────────────────────────

describe('Pulse Tree sum annotations', () => {
  it('tracks total credits across all leaves', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 0, 10.5));
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 1, 2.25));
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 2, -3.0));
    tree.append(makeLeaf(PULSE_TYPE.CHECKPOINT, 3, 0));

    expect(tree.totalCredits).toBeCloseTo(9.75, 6);
  });

  it('internal nodes carry correct cumulative sums', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 0, 10));
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 1, 20));

    // Position 2 should be the parent with sumCredits = 30
    const parent = tree.getNode(2);
    expect(parent).toBeDefined();
    expect(parent!.sumCredits).toBe(30);
    expect(parent!.height).toBe(1);
  });

  it('sum propagates through multi-level merges', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 0, 10));
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 1, 20));
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 2, 30));
    tree.append(makeLeaf(PULSE_TYPE.ECONOMIC, 3, 40));

    // After 4 leaves: single peak at position 6, height 2
    const peak = tree.getNode(6);
    expect(peak).toBeDefined();
    expect(peak!.sumCredits).toBe(100);
    expect(peak!.height).toBe(2);
  });
});

// ─── Inclusion Proofs ──────────────────────────────────────────────────────

describe('Pulse Tree inclusion proofs', () => {
  it('generates and verifies a proof for a single leaf', () => {
    const tree = new PulseTree();
    const leaf = makeLeaf(PULSE_TYPE.ACTION, 0);
    tree.append(leaf);

    const proof = tree.generateProof(0);
    expect(proof.leafIndex).toBe(0);
    expect(proof.siblings).toHaveLength(0); // leaf IS the peak
    expect(PulseTree.verifyProof(proof, leaf)).toBe(true);
  });

  it('generates and verifies proof for two leaves', () => {
    const tree = new PulseTree();
    const leaf0 = makeLeaf(PULSE_TYPE.ACTION, 0);
    const leaf1 = makeLeaf(PULSE_TYPE.ECONOMIC, 1, 5);
    tree.append(leaf0);
    tree.append(leaf1);

    const proof0 = tree.generateProof(0);
    expect(proof0.siblings).toHaveLength(1);
    expect(PulseTree.verifyProof(proof0, leaf0)).toBe(true);

    const proof1 = tree.generateProof(1);
    expect(proof1.siblings).toHaveLength(1);
    expect(PulseTree.verifyProof(proof1, leaf1)).toBe(true);
  });

  it('verifies proofs for all leaves in a 7-leaf tree', () => {
    const tree = new PulseTree();
    const leaves: PulseLeaf[] = [];

    for (let i = 0; i < 7; i++) {
      const leaf = makeLeaf(PULSE_TYPE.ACTION, i, i * 2);
      leaves.push(leaf);
      tree.append(leaf);
    }

    for (let i = 0; i < 7; i++) {
      const proof = tree.generateProof(i);
      expect(PulseTree.verifyProof(proof, leaves[i])).toBe(true);
    }
  });

  it('verifies proofs for all leaves in a 16-leaf tree', () => {
    const tree = new PulseTree();
    const leaves: PulseLeaf[] = [];

    for (let i = 0; i < 16; i++) {
      const leaf = makeLeaf(i % 7 === 0 ? PULSE_TYPE.CHECKPOINT : PULSE_TYPE.ACTION, i, i);
      leaves.push(leaf);
      tree.append(leaf);
    }

    for (let i = 0; i < 16; i++) {
      const proof = tree.generateProof(i);
      expect(PulseTree.verifyProof(proof, leaves[i])).toBe(true);
    }
  });

  it('rejects tampered leaf in proof', () => {
    const tree = new PulseTree();
    const real = makeLeaf(PULSE_TYPE.ECONOMIC, 0, 100);
    tree.append(real);

    const proof = tree.generateProof(0);
    const fake = { ...real, creditDelta: 999 };
    expect(PulseTree.verifyProof(proof, fake)).toBe(false);
  });

  it('rejects proof with wrong leaf index', () => {
    const tree = new PulseTree();
    const leaf0 = makeLeaf(PULSE_TYPE.ACTION, 0);
    const leaf1 = makeLeaf(PULSE_TYPE.ACTION, 1);
    tree.append(leaf0);
    tree.append(leaf1);

    const proof1 = tree.generateProof(1);
    // Try to verify leaf0 against proof1's path
    expect(PulseTree.verifyProof(proof1, leaf0)).toBe(false);
  });

  it('throws on out-of-range leaf index', () => {
    const tree = new PulseTree();
    tree.append(makeLeaf(PULSE_TYPE.ACTION, 0));
    expect(() => tree.generateProof(5)).toThrow();
    expect(() => tree.generateProof(-1)).toThrow();
  });
});

// ─── State Export ──────────────────────────────────────────────────────────

describe('Pulse Tree state export', () => {
  it('exports compact state with peaks only', () => {
    const tree = new PulseTree();
    for (let i = 0; i < 5; i++) tree.append(makeLeaf(PULSE_TYPE.ACTION, i, i * 10));

    const state = tree.exportState();
    expect(state.leafCount).toBe(5);
    expect(state.totalCredits).toBe(100); // 0+10+20+30+40
    expect(state.root).toBe(tree.getRoot());
    expect(state.peaks).toHaveLength(getPeaks(tree.size).length);
  });
});

// ─── Scale / Performance ───────────────────────────────────────────────────

describe('Pulse Tree scale', () => {
  it('handles 1000 leaves correctly', () => {
    const tree = new PulseTree();
    const leaves: PulseLeaf[] = [];

    for (let i = 0; i < 1000; i++) {
      const leaf = makeLeaf(PULSE_TYPE.ACTION, i, 1);
      leaves.push(leaf);
      tree.append(leaf);
    }

    expect(tree.leafCount).toBe(1000);
    expect(tree.totalCredits).toBe(1000);

    // Verify random proofs
    for (const idx of [0, 1, 499, 500, 998, 999]) {
      const proof = tree.generateProof(idx);
      expect(PulseTree.verifyProof(proof, leaves[idx])).toBe(true);
    }
  });

  it('append + root is fast (benchmark)', () => {
    const tree = new PulseTree();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      tree.append(makeLeaf(PULSE_TYPE.ACTION, i, 0.01));
    }
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round(10000 / (elapsed / 1000));

    // Should be > 5000 ops/sec (target: >10K)
    expect(opsPerSec).toBeGreaterThan(5000);
    expect(tree.leafCount).toBe(10000);
  });
});
