/**
 * verified-computation.ts — Verified Computation Orchestrator
 *
 * High-level wrapper that ties commit-reveal + spot-check + certificate
 * together into a single "run verified computation" call.
 *
 * Usage:
 *   const result = await runVerifiedComputation({
 *     requestId: 'req-123',
 *     computationType: 'sort',
 *     input: [3, 1, 4, 1, 5],
 *     compute: (data) => [...data].sort((a, b) => a - b),
 *     verify: (input, output, seed) => checkSort(input, output, seed),
 *   });
 *   // result.output = [1, 1, 3, 4, 5]
 *   // result.certificate = ComputationCertificate (signed, persisted)
 *
 * Ref: internal/heartbeat-fraud-proofs.md §2, §7
 */

import { generateSeedCommitment, revealSeed } from './commit-reveal';
import { getComputationType, type ComputationType } from './computation-types';
import { createComputationCertificate, type ComputationCertificate } from './computation-certificate';
import { checkEconomicOnly, type SpotCheckResult } from './spot-check';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { awardSignal } from '../db/signal';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VerifiedComputationOpts<TInput, TOutput> {
  /** Request ID for tracing */
  requestId: string;
  /** Registered computation type ID (e.g., 'sort', 'sum', 'ml-inference') */
  computationType: string;
  /** The input data */
  input: TInput;
  /** The computation function — takes input, returns output */
  compute: (input: TInput) => TOutput | Promise<TOutput>;
  /** The verification function — runs spot-checks using the committed seed */
  verify: (input: TInput, output: TOutput, seed: string) => SpotCheckResult | SpotCheckResult[];
  /** Optional API key for signal award */
  apiKey?: string;
  /** Optional birth cert hash to bind to */
  birthCertHash?: string;
}

export interface VerifiedComputationResult<TOutput> {
  /** The computation output */
  output: TOutput;
  /** The computation certificate (null if spot-checks failed) */
  certificate: ComputationCertificate | null;
  /** Whether all spot-checks passed */
  verified: boolean;
  /** The spot-check results */
  spotChecks: SpotCheckResult[];
  /** Duration of the full verify flow in ms */
  durationMs: number;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run a computation with full commit-reveal verification.
 *
 * Flow:
 *   1. Generate seed commitment
 *   2. Run the computation
 *   3. Commit the output hash
 *   4. Reveal the seed
 *   5. Run spot-checks with the revealed seed
 *   6. If all pass → issue computation certificate + award signal
 *   7. Return result + certificate
 */
export async function runVerifiedComputation<TInput, TOutput>(
  opts: VerifiedComputationOpts<TInput, TOutput>,
): Promise<VerifiedComputationResult<TOutput>> {
  const start = Date.now();

  // Look up computation type (optional — if not registered, we still run but skip type metadata)
  const compType = getComputationType(opts.computationType);

  // Step 1: Generate seed commitment
  const seedCommitment = generateSeedCommitment();

  // Step 2: Run the computation
  const output = await opts.compute(opts.input);

  // Step 3: Commit the output hash
  const outputHash = hashValue(output);
  const outputCommitment = somaHash(outputHash);

  // Step 4: Reveal the seed (binds to output commitment)
  const revealed = revealSeed(seedCommitment, outputCommitment);

  // Step 5: Run spot-checks
  let spotChecks: SpotCheckResult[];
  if (compType?.class === 'economic-only') {
    // No Layer 1 verification — just record the passthrough
    spotChecks = [checkEconomicOnly(opts.computationType)];
  } else {
    const checkResult = opts.verify(opts.input, output, revealed.seed);
    spotChecks = Array.isArray(checkResult) ? checkResult : [checkResult];
  }

  const allPassed = spotChecks.every(sc => sc.passed);

  // Step 6: Issue computation certificate (only if spot-checks passed)
  let certificate: ComputationCertificate | null = null;
  if (allPassed) {
    certificate = createComputationCertificate({
      requestId: opts.requestId,
      computationType: opts.computationType,
      computationClass: compType?.class ?? 'economic-only',
      inputHash: hashValue(opts.input),
      outputHash,
      seedCommitment: seedCommitment.commitment,
      seed: seedCommitment.seed,
      outputCommitment,
      spotChecks,
      birthCertHash: opts.birthCertHash,
    });

    // Award signal for verified computation
    if (opts.apiKey && certificate) {
      try {
        awardSignal({
          apiKey: opts.apiKey,
          action: 'computation_verified',
          metadata: {
            computationType: opts.computationType,
            computationClass: compType?.class,
            certId: certificate.id,
          },
        });
      } catch {
        // Signal is fire-and-forget
      }
    }
  } else {
    logger.warn({
      requestId: opts.requestId,
      computationType: opts.computationType,
      failedChecks: spotChecks.filter(sc => !sc.passed).map(sc => sc.checkName),
    }, 'Verified computation: spot-checks failed — no certificate issued');
  }

  return {
    output,
    certificate,
    verified: allPassed,
    spotChecks,
    durationMs: Date.now() - start,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Hash any value deterministically using JCS for objects, somaHash for strings */
function hashValue(value: unknown): string {
  if (typeof value === 'string') return somaHash(value);
  if (Buffer.isBuffer(value)) return somaHash(value.toString('utf8'));
  return somaHashJson(value);
}
