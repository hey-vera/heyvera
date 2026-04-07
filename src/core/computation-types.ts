/**
 * computation-types.ts — Computation Type Taxonomy
 *
 * Every computation must declare its class. The class determines which
 * verification strategy applies and what security guarantees are provided.
 *
 * Classes:
 *   - algebraic:    Freivalds/Schwartz-Zippel, P(miss) = 2^(-k)
 *   - structural:   Full O(N) scan or multiset hash
 *   - aggregation:  O(1) — check parts = total, bounds checks
 *   - approximate:  Tolerance-based, |result - expected| < epsilon
 *   - economic-only: No cheap verification (ML inference, generative tasks)
 *
 * Ref: internal/heartbeat-fraud-proofs.md §1
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComputationClass =
  | 'algebraic'
  | 'structural'
  | 'aggregation'
  | 'approximate'
  | 'economic-only';

export type ProbabilityModel =
  | 'freivalds'     // 2^(-k) for k trials — algebraic class
  | 'full-scan'     // O(N) full verification — structural class
  | 'exact'         // O(1) exact check — aggregation class
  | 'tolerance'     // |a - b| < epsilon — approximate class
  | 'none';         // no verification possible — economic-only

export interface ComputationType {
  /** Unique identifier for this computation type (e.g., 'sort', 'matrix-multiply', 'sum') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Verification class — determines which spot-check strategy applies */
  class: ComputationClass;
  /** Probability model for detection calculations */
  probabilityModel: ProbabilityModel;
  /** For approximate class: maximum allowed tolerance */
  epsilon?: number;
  /** Number of spot-check trials (algebraic class: k in 2^(-k)) */
  spotCheckTrials?: number;
  /** Description of what this computation does */
  description?: string;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const _registry = new Map<string, ComputationType>();

/** Register a computation type in the taxonomy. */
export function registerComputationType(type: ComputationType): void {
  validateComputationType(type);
  _registry.set(type.id, type);
}

/** Look up a computation type by ID. */
export function getComputationType(id: string): ComputationType | null {
  return _registry.get(id) ?? null;
}

/** Get all registered computation types. */
export function getAllComputationTypes(): ComputationType[] {
  return [..._registry.values()];
}

/** Validate that a computation type is well-formed. */
function validateComputationType(type: ComputationType): void {
  if (!type.id || !type.name || !type.class) {
    throw new Error(`ComputationType: id, name, and class are required`);
  }
  // Enforce correct probability model for each class
  const expectedModel: Record<ComputationClass, ProbabilityModel> = {
    'algebraic': 'freivalds',
    'structural': 'full-scan',
    'aggregation': 'exact',
    'approximate': 'tolerance',
    'economic-only': 'none',
  };
  if (type.probabilityModel !== expectedModel[type.class]) {
    throw new Error(
      `ComputationType '${type.id}': class '${type.class}' requires probabilityModel '${expectedModel[type.class]}', got '${type.probabilityModel}'`,
    );
  }
  if (type.class === 'approximate' && (type.epsilon == null || type.epsilon <= 0)) {
    throw new Error(`ComputationType '${type.id}': approximate class requires epsilon > 0`);
  }
  if (type.class === 'algebraic' && (type.spotCheckTrials == null || type.spotCheckTrials < 1)) {
    throw new Error(`ComputationType '${type.id}': algebraic class requires spotCheckTrials >= 1`);
  }
}

/**
 * Calculate the theoretical detection probability for a given computation class and parameters.
 * Returns 0-1 where 1 = guaranteed detection.
 */
export function detectionProbability(type: ComputationType): number {
  switch (type.class) {
    case 'algebraic':
      // Freivalds: P(miss) = 2^(-k) → P(detect) = 1 - 2^(-k)
      return 1 - Math.pow(2, -(type.spotCheckTrials ?? 1));
    case 'structural':
      // Full scan: guaranteed detection
      return 1.0;
    case 'aggregation':
      // Exact bounds check: guaranteed detection
      return 1.0;
    case 'approximate':
      // Tolerance: detects errors > epsilon, misses errors <= epsilon
      // We return 1.0 for detected class, caller handles epsilon caveat
      return 1.0;
    case 'economic-only':
      // No Layer 1 verification — Layers 2+3 only
      return 0.0;
  }
}

// ─── Built-in Types ─────────────────────────────────────────────────────────

/** Register the standard computation types. Called once at startup. */
export function registerBuiltinTypes(): void {
  // Algebraic — Freivalds-verifiable
  registerComputationType({
    id: 'matrix-multiply',
    name: 'Matrix Multiplication',
    class: 'algebraic',
    probabilityModel: 'freivalds',
    spotCheckTrials: 20,
    description: 'Matrix product C = A × B verified via Freivalds algorithm',
  });

  // Structural — O(N) full scan
  registerComputationType({
    id: 'sort',
    name: 'Sort',
    class: 'structural',
    probabilityModel: 'full-scan',
    description: 'Sorted output verified via O(N) order + multiset hash',
  });
  registerComputationType({
    id: 'filter',
    name: 'Filter',
    class: 'structural',
    probabilityModel: 'full-scan',
    description: 'Filtered output verified via predicate re-evaluation + completeness check',
  });
  registerComputationType({
    id: 'dedup',
    name: 'Deduplicate',
    class: 'structural',
    probabilityModel: 'full-scan',
    description: 'Deduplicated output verified via uniqueness + multiset subset check',
  });

  // Aggregation — O(1) exact
  registerComputationType({
    id: 'sum',
    name: 'Sum',
    class: 'aggregation',
    probabilityModel: 'exact',
    description: 'Sum verified by re-computing from input elements',
  });
  registerComputationType({
    id: 'count',
    name: 'Count',
    class: 'aggregation',
    probabilityModel: 'exact',
    description: 'Count verified against input length',
  });
  registerComputationType({
    id: 'min-max',
    name: 'Min/Max',
    class: 'aggregation',
    probabilityModel: 'exact',
    description: 'Min/max verified via single-pass bounds check',
  });

  // Approximate — tolerance-based
  registerComputationType({
    id: 'average',
    name: 'Average',
    class: 'approximate',
    probabilityModel: 'tolerance',
    epsilon: 1e-9,
    description: 'Average verified within floating-point epsilon tolerance',
  });

  // Economic-only — no cheap verification
  registerComputationType({
    id: 'ml-inference',
    name: 'ML Inference',
    class: 'economic-only',
    probabilityModel: 'none',
    description: 'ML inference — non-deterministic across architectures, economic verification only',
  });
  registerComputationType({
    id: 'llm-generation',
    name: 'LLM Text Generation',
    class: 'economic-only',
    probabilityModel: 'none',
    description: 'LLM generation — inherently non-deterministic, economic verification only',
  });
}
