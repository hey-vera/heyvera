/**
 * trust-import.ts — Cross-protocol trust import
 *
 * Agents with trust on other platforms can import it to ClawNet
 * instead of starting from zero.
 *
 * Supported sources:
 *   - ERC-8004 reputation (on-chain, The Graph subgraph)
 *   - x402 payment history (facilitator-signed receipts)
 *   - Maiat trust scores (API-queryable)
 *
 * Rules:
 *   - Imported trust capped at 39 (building tier, base price, NO discount)
 *   - Requires 20 local transactions before import adds to score
 *   - Import only proves "this agent exists on other platforms"
 *   - proofData is NOT yet validated — see soma-trust-mining.md Innovation 4
 *     for the planned "import evidence, not verdicts" upgrade
 */

import { getDb, logAudit } from '../db/connection';
import { somaHash } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ImportSource = 'erc8004' | 'x402' | 'maiat' | 'other';

export interface TrustImport {
  id: string;
  did: string;
  source: ImportSource;
  sourceIdentifier: string;
  importedScore: number;
  cappedScore: number;
  verified: boolean;
  verificationHash: string;
  localTxRequired: number;
  localTxCompleted: number;
  active: boolean;
  importedAt: string;
}

export interface ImportResult {
  success: boolean;
  import?: TrustImport;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_IMPORTED_SCORE = 39; // building tier, no discount
const LOCAL_TX_REQUIRED = 20;

// ─── Import Functions ───────────────────────────────────────────────────────

/**
 * Import trust from an external platform.
 *
 * @param did - Agent's DID
 * @param source - Source platform
 * @param sourceIdentifier - Platform-specific ID (ERC-8004 agent ID, x402 wallet, etc.)
 * @param externalScore - The claimed score from the external platform (0-100)
 * @param proofData - Platform-specific proof data (signature, tx hash, etc.)
 */
export function importTrust(
  did: string,
  source: ImportSource,
  sourceIdentifier: string,
  externalScore: number,
  proofData?: Record<string, unknown>,
): ImportResult {
  // Check DID exists
  const aidKey = getDb().prepare(
    `SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
  ).get(did) as { owner_key: string } | undefined;

  if (!aidKey) {
    return { success: false, error: 'DID not found' };
  }

  // Check for existing import from same source
  const existing = getDb().prepare(
    `SELECT id FROM aid_trust_imports WHERE did = ? AND source = ? AND active = 1 LIMIT 1`
  ).get(did, source) as { id: string } | undefined;

  if (existing) {
    return { success: false, error: `Trust already imported from ${source}` };
  }

  // Cap the imported score
  const cappedScore = Math.min(externalScore, MAX_IMPORTED_SCORE);

  // Check local transaction count
  let localTxCompleted = 0;
  try {
    const txCount = getDb().prepare(
      `SELECT total_attestations FROM attestation_stats WHERE owner_key = ? LIMIT 1`
    ).get(aidKey.owner_key) as { total_attestations: number } | undefined;
    localTxCompleted = txCount?.total_attestations ?? 0;
  } catch { /* non-critical */ }

  // Create verification hash
  const verificationHash = somaHash(JSON.stringify({
    did, source, sourceIdentifier, externalScore, timestamp: Date.now(),
    proof: proofData,
  }));

  const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    getDb().prepare(`
      INSERT INTO aid_trust_imports (id, did, source, source_identifier, imported_score,
                                    capped_score, verified, verification_hash,
                                    local_tx_required, local_tx_completed, active)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)
    `).run(id, did, source, sourceIdentifier, externalScore, cappedScore,
           verificationHash, LOCAL_TX_REQUIRED, localTxCompleted);

    logAudit({
      entityType: 'trust_import', entityId: id, action: 'imported',
      data: { did, source, externalScore, cappedScore },
    });

    logger.info({ did: did.slice(0, 20), source, externalScore, cappedScore }, 'Trust imported');

    const trustImport: TrustImport = {
      id, did, source, sourceIdentifier,
      importedScore: externalScore, cappedScore,
      verified: false, verificationHash,
      localTxRequired: LOCAL_TX_REQUIRED,
      localTxCompleted,
      active: true, importedAt: new Date().toISOString(),
    };

    return { success: true, import: trustImport };
  } catch (err: any) {
    logger.error({ err }, 'Trust import failed');
    return { success: false, error: err.message };
  }
}

/**
 * Get the effective imported trust score for a DID.
 * Returns 0 if the agent hasn't completed enough local transactions.
 */
export function getImportedTrustBoost(did: string): number {
  try {
    const imports = getDb().prepare(`
      SELECT capped_score, local_tx_required, local_tx_completed
      FROM aid_trust_imports WHERE did = ? AND active = 1
    `).all(did) as Array<{ capped_score: number; local_tx_required: number; local_tx_completed: number }>;

    if (imports.length === 0) return 0;

    // Only count imports where local tx threshold is met
    let maxBoost = 0;
    for (const imp of imports) {
      if (imp.local_tx_completed >= imp.local_tx_required) {
        maxBoost = Math.max(maxBoost, imp.capped_score);
      }
    }

    return maxBoost;
  } catch {
    return 0;
  }
}

/**
 * List trust imports for a DID.
 */
export function getImports(did: string): TrustImport[] {
  return getDb().prepare(`
    SELECT * FROM aid_trust_imports WHERE did = ? ORDER BY imported_at DESC
  `).all(did) as any[];
}

/**
 * Revoke a trust import.
 */
export function revokeImport(importId: string): boolean {
  return getDb().prepare(
    `UPDATE aid_trust_imports SET active = 0 WHERE id = ?`
  ).run(importId).changes > 0;
}
