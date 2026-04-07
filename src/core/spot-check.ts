/**
 * spot-check.ts — Semantic Spot-Check Library
 *
 * Per-computation-class verification functions with correct probability models.
 * Each check is deterministic given the committed seed, so results are
 * reproducible by any third party.
 *
 * Classes:
 *   - algebraic:   Freivalds' algorithm (matrix multiply)
 *   - structural:  Full O(N) order check + multiset hash (sort, filter, dedup)
 *   - aggregation: Exact re-computation (sum, count, min/max)
 *   - approximate: Tolerance-based (average, numerical)
 *   - economic-only: No spot-check (returns pass with 0 confidence)
 *
 * Ref: internal/heartbeat-fraud-proofs.md §1, §4
 */

import { createHmac } from 'crypto';
import { deriveFreivaldsRandom, deriveCheckIndices } from './commit-reveal';
import type { ComputationType } from './computation-types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpotCheckResult {
  /** Name of the check performed */
  checkName: string;
  /** Whether the check passed */
  passed: boolean;
  /** Confidence level 0-1 */
  confidence: number;
  /** Probability model used */
  probabilityModel: string;
  /** Detection probability for this check */
  detectionProbability: number;
  /** Optional detail about what was checked */
  detail?: string;
}

// ─── MSet-XOR-Hash ──────────────────────────────────────────────────────────

/**
 * Multiset hash using HMAC-SHA256 XOR accumulation.
 * Order-independent: H(a,b) = H(b,a). Collision-resistant under HMAC-SHA256.
 * Used to verify sort/filter/dedup preserve the correct multiset of elements.
 *
 * @param elements — Array of string-serialized elements
 * @param key      — HMAC key (derived from committed seed for determinism)
 */
export function msetXorHash(elements: readonly unknown[], key: string): string {
  const keyBuf = Buffer.from(key, 'hex');
  let accumulator = Buffer.alloc(32); // 256-bit zero

  for (const elem of elements) {
    const elemStr = typeof elem === 'string' ? elem : JSON.stringify(elem);
    const h = createHmac('sha256', keyBuf).update(elemStr).digest();
    for (let i = 0; i < 32; i++) {
      accumulator[i] ^= h[i];
    }
  }

  return accumulator.toString('hex');
}

// ─── Structural Checks ─────────────────────────────────────────────────────

/**
 * Verify a sort operation: output is ordered AND contains the same multiset as input.
 * O(N) — full scan, guaranteed detection.
 */
export function checkSort(
  input: readonly unknown[],
  output: readonly unknown[],
  seed: string,
  compareFn?: (a: unknown, b: unknown) => number,
): SpotCheckResult {
  // Default comparator: numeric or string
  const cmp = compareFn ?? ((a: unknown, b: unknown) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });

  // Check 1: output is sorted
  for (let i = 1; i < output.length; i++) {
    if (cmp(output[i - 1], output[i]) > 0) {
      return {
        checkName: 'sort-order',
        passed: false,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
        detail: `Output not sorted at index ${i}: ${JSON.stringify(output[i - 1])} > ${JSON.stringify(output[i])}`,
      };
    }
  }

  // Check 2: multiset equality (same elements, same multiplicities)
  const hmacKey = createHmac('sha256', Buffer.from(seed, 'hex'))
    .update('mset-sort')
    .digest('hex');
  const inputHash = msetXorHash(input, hmacKey);
  const outputHash = msetXorHash(output, hmacKey);

  if (inputHash !== outputHash) {
    return {
      checkName: 'sort-multiset',
      passed: false,
      confidence: 1.0,
      probabilityModel: 'full-scan',
      detectionProbability: 1.0,
      detail: 'Multiset mismatch — elements were added or removed during sort',
    };
  }

  return {
    checkName: 'sort',
    passed: true,
    confidence: 1.0,
    probabilityModel: 'full-scan',
    detectionProbability: 1.0,
  };
}

/**
 * Verify a filter operation: every output element satisfies the predicate,
 * and no input element satisfying the predicate was omitted.
 */
export function checkFilter(
  input: readonly unknown[],
  output: readonly unknown[],
  predicate: (elem: unknown) => boolean,
  seed: string,
): SpotCheckResult {
  // Check 1: all output elements satisfy predicate
  for (let i = 0; i < output.length; i++) {
    if (!predicate(output[i])) {
      return {
        checkName: 'filter-predicate',
        passed: false,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
        detail: `Output[${i}] does not satisfy predicate`,
      };
    }
  }

  // Check 2: no qualifying input element was omitted (completeness)
  const expected = input.filter(predicate);
  const hmacKey = createHmac('sha256', Buffer.from(seed, 'hex'))
    .update('mset-filter')
    .digest('hex');
  const expectedHash = msetXorHash(expected, hmacKey);
  const outputHash = msetXorHash(output, hmacKey);

  if (expectedHash !== outputHash) {
    return {
      checkName: 'filter-completeness',
      passed: false,
      confidence: 1.0,
      probabilityModel: 'full-scan',
      detectionProbability: 1.0,
      detail: `Filter omitted or added elements (expected ${expected.length}, got ${output.length})`,
    };
  }

  return {
    checkName: 'filter',
    passed: true,
    confidence: 1.0,
    probabilityModel: 'full-scan',
    detectionProbability: 1.0,
  };
}

/**
 * Verify a dedup operation: output has no duplicates AND is a subset of input.
 */
export function checkDedup(
  input: readonly unknown[],
  output: readonly unknown[],
  seed: string,
): SpotCheckResult {
  // Check 1: no duplicates in output
  const seen = new Set<string>();
  for (let i = 0; i < output.length; i++) {
    const key = JSON.stringify(output[i]);
    if (seen.has(key)) {
      return {
        checkName: 'dedup-uniqueness',
        passed: false,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
        detail: `Duplicate at output[${i}]: ${key}`,
      };
    }
    seen.add(key);
  }

  // Check 2: every output element exists in input
  const inputSet = new Set(input.map(e => JSON.stringify(e)));
  for (let i = 0; i < output.length; i++) {
    if (!inputSet.has(JSON.stringify(output[i]))) {
      return {
        checkName: 'dedup-subset',
        passed: false,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
        detail: `Output[${i}] not found in input`,
      };
    }
  }

  // Check 3: all unique input elements are represented
  const uniqueInput = new Set(input.map(e => JSON.stringify(e)));
  if (seen.size !== uniqueInput.size) {
    return {
      checkName: 'dedup-completeness',
      passed: false,
      confidence: 1.0,
      probabilityModel: 'full-scan',
      detectionProbability: 1.0,
      detail: `Expected ${uniqueInput.size} unique elements, got ${seen.size}`,
    };
  }

  return {
    checkName: 'dedup',
    passed: true,
    confidence: 1.0,
    probabilityModel: 'full-scan',
    detectionProbability: 1.0,
  };
}

// ─── Aggregation Checks ─────────────────────────────────────────────────────

/**
 * Verify a sum aggregation by re-computing from input elements.
 */
export function checkSum(
  input: readonly number[],
  claimedSum: number,
): SpotCheckResult {
  let actual = 0;
  for (const n of input) actual += n;

  const passed = actual === claimedSum;
  return {
    checkName: 'sum',
    passed,
    confidence: 1.0,
    probabilityModel: 'exact',
    detectionProbability: 1.0,
    detail: passed ? undefined : `Expected ${actual}, got ${claimedSum}`,
  };
}

/**
 * Verify a count aggregation.
 */
export function checkCount(
  input: readonly unknown[],
  claimedCount: number,
): SpotCheckResult {
  const passed = input.length === claimedCount;
  return {
    checkName: 'count',
    passed,
    confidence: 1.0,
    probabilityModel: 'exact',
    detectionProbability: 1.0,
    detail: passed ? undefined : `Expected ${input.length}, got ${claimedCount}`,
  };
}

/**
 * Verify min/max aggregation via single-pass bounds check.
 */
export function checkMinMax(
  input: readonly number[],
  claimedMin: number,
  claimedMax: number,
): SpotCheckResult {
  if (input.length === 0) {
    return {
      checkName: 'min-max',
      passed: false,
      confidence: 1.0,
      probabilityModel: 'exact',
      detectionProbability: 1.0,
      detail: 'Empty input',
    };
  }

  let actualMin = input[0];
  let actualMax = input[0];
  for (let i = 1; i < input.length; i++) {
    if (input[i] < actualMin) actualMin = input[i];
    if (input[i] > actualMax) actualMax = input[i];
  }

  const passed = actualMin === claimedMin && actualMax === claimedMax;
  return {
    checkName: 'min-max',
    passed,
    confidence: 1.0,
    probabilityModel: 'exact',
    detectionProbability: 1.0,
    detail: passed ? undefined : `Expected min=${actualMin} max=${actualMax}, got min=${claimedMin} max=${claimedMax}`,
  };
}

// ─── Algebraic Check: Freivalds ─────────────────────────────────────────────

/**
 * Freivalds' algorithm for verifying matrix multiplication C = A × B.
 * k trials → P(miss) = 2^(-k). Each trial picks a random vector r,
 * checks A(Br) = Cr. O(N²) per trial instead of O(N³) for recomputation.
 *
 * Matrices are row-major 2D arrays. All arithmetic is mod prime to avoid
 * floating-point non-determinism.
 *
 * @param A     — m × p matrix
 * @param B     — p × n matrix
 * @param C     — m × n claimed result
 * @param seed  — committed seed for deterministic random vectors
 * @param trials — number of trials (default 20 → P(miss) ≈ 10^(-6))
 * @param prime — field prime (default 2^31-1)
 */
export function checkFreivalds(
  A: readonly (readonly number[])[],
  B: readonly (readonly number[])[],
  C: readonly (readonly number[])[],
  seed: string,
  trials = 20,
  prime = 2147483647,
): SpotCheckResult {
  const m = A.length;
  const p = B.length;
  const n = B[0]?.length ?? 0;

  // Dimension checks
  if (C.length !== m || (C[0]?.length ?? 0) !== n) {
    return {
      checkName: 'freivalds',
      passed: false,
      confidence: 1.0,
      probabilityModel: 'freivalds',
      detectionProbability: 1.0,
      detail: `Dimension mismatch: A=${m}×${p}, B=${p}×${n}, C=${C.length}×${C[0]?.length}`,
    };
  }

  for (const row of A) if (row.length !== p) {
    return { checkName: 'freivalds', passed: false, confidence: 1.0, probabilityModel: 'freivalds', detectionProbability: 1.0, detail: 'Ragged matrix A' };
  }

  for (let t = 0; t < trials; t++) {
    // Generate random vector r of length n
    const r: number[] = [];
    for (let j = 0; j < n; j++) {
      r.push(deriveFreivaldsRandom(seed, t, j, prime));
    }

    // Compute Br (p × 1)
    const Br: number[] = new Array(p).fill(0);
    for (let i = 0; i < p; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum = modAdd(sum, modMul(B[i][j], r[j], prime), prime);
      }
      Br[i] = sum;
    }

    // Compute A(Br) (m × 1)
    const ABr: number[] = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < p; j++) {
        sum = modAdd(sum, modMul(A[i][j], Br[j], prime), prime);
      }
      ABr[i] = sum;
    }

    // Compute Cr (m × 1)
    const Cr: number[] = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum = modAdd(sum, modMul(C[i][j], r[j], prime), prime);
      }
      Cr[i] = sum;
    }

    // Check A(Br) = Cr
    for (let i = 0; i < m; i++) {
      if (ABr[i] !== Cr[i]) {
        return {
          checkName: 'freivalds',
          passed: false,
          confidence: 1.0,
          probabilityModel: 'freivalds',
          detectionProbability: 1 - Math.pow(2, -trials),
          detail: `Trial ${t}: row ${i} mismatch (A(Br)[${i}]=${ABr[i]} ≠ Cr[${i}]=${Cr[i]})`,
        };
      }
    }
  }

  return {
    checkName: 'freivalds',
    passed: true,
    confidence: 1 - Math.pow(2, -trials),
    probabilityModel: 'freivalds',
    detectionProbability: 1 - Math.pow(2, -trials),
  };
}

// ─── Approximate Check ──────────────────────────────────────────────────────

/**
 * Tolerance-based check for approximate computations.
 * Returns true if |actual - claimed| < epsilon.
 */
export function checkApproximate(
  actual: number,
  claimed: number,
  epsilon: number,
): SpotCheckResult {
  const diff = Math.abs(actual - claimed);
  const passed = diff < epsilon;
  return {
    checkName: 'approximate',
    passed,
    confidence: passed ? 1.0 : 1.0,
    probabilityModel: 'tolerance',
    detectionProbability: 1.0,
    detail: passed ? undefined : `|${actual} - ${claimed}| = ${diff} >= epsilon ${epsilon}`,
  };
}

// ─── Economic-Only Passthrough ──────────────────────────────────────────────

/**
 * No-op check for economic-only computations.
 * Returns pass with 0 confidence — verification comes from Layers 2+3 only.
 */
export function checkEconomicOnly(computationType: string): SpotCheckResult {
  return {
    checkName: `economic-only:${computationType}`,
    passed: true,
    confidence: 0.0,
    probabilityModel: 'none',
    detectionProbability: 0.0,
    detail: 'No Layer 1 verification — relies on bond + challenge (Layers 2+3)',
  };
}

// ─── Modular Arithmetic Helpers ─────────────────────────────────────────────

/** Modular addition: (a + b) mod p, handling potential overflow via BigInt */
function modAdd(a: number, b: number, p: number): number {
  return Number((BigInt(a) + BigInt(b)) % BigInt(p));
}

/** Modular multiplication: (a × b) mod p, using BigInt for overflow safety */
function modMul(a: number, b: number, p: number): number {
  return Number((BigInt(a) * BigInt(b)) % BigInt(p));
}
