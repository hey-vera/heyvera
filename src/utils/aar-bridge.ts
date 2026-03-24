/**
 * aar-bridge.ts — Bidirectional AAR ↔ AID receipt conversion (Optimization 12)
 *
 * BotIndex Agent Action Receipts (AAR) is an Ed25519-signed receipt spec.
 * AID receipts are a SUPERSET (trust scoring, Merkle anchoring, feedback loop).
 *
 * This bridge enables:
 *   1. Import AAR receipts from external agents → count toward AID trust score
 *   2. Export AID receipts as AAR format → portable to AAR-compatible platforms
 *
 * AAR format (from BotIndex spec):
 *   {
 *     "receiptId": "string",
 *     "agentDid": "did:key:z...",
 *     "action": "string",
 *     "timestamp": "ISO8601",
 *     "inputHash": "sha256:...",
 *     "outputHash": "sha256:...",
 *     "success": boolean,
 *     "durationMs": number,
 *     "signature": "ed25519:base64..."
 *   }
 *
 * AID receipt format is defined in spec Section 5.1 and receipt-builder.ts.
 *
 * @license MIT
 */

import { aidHash, aidHashPrefixed } from './crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

/** BotIndex AAR format */
export interface AARReceipt {
  receiptId: string;
  agentDid: string;
  action: string;
  timestamp: string;
  inputHash: string;
  outputHash: string;
  success: boolean;
  durationMs: number;
  signature: string;
  metadata?: Record<string, unknown>;
}

/** AID receipt format (simplified for bridge purposes) */
export interface AIDReceipt {
  protocol: 'AID';
  version: string;
  receiptId: string;
  timestamp: string;
  payer: {
    did: string;
    trustScore?: number;
    signature?: string;
  };
  provider: {
    did: string;
    trustScore?: number;
    signature?: string;
  };
  service: {
    id: string;
    type: string;
    inputHash: string;
    resultHash: string;
  };
  payment?: {
    amount: string;
    currency: string;
    settlementMode: string;
    settled: boolean;
  };
  trust?: {
    merkleRoot: string | null;
    merkleProof: unknown[];
    feedbackUrl: string | null;
  };
  execution?: {
    success: boolean;
    durationMs: number;
    steps?: unknown[];
  };
}

// ─── AAR → AID Conversion ───────────────────────────────────────────────────

/**
 * Convert an AAR receipt to AID receipt format.
 *
 * Used when importing receipts from external AAR-compatible platforms
 * to count toward an agent's AID trust score.
 *
 * Note: imported receipts have limited trust weight (cannot verify
 * the original execution, only the signature).
 */
export function aarToAid(aar: AARReceipt): AIDReceipt {
  // Re-hash with SHA-256 (AID standard) if incoming uses SHA-256
  const inputHash = aar.inputHash.startsWith('sha256:')
    ? aar.inputHash
    : aidHashPrefixed(aar.inputHash);

  const resultHash = aar.outputHash.startsWith('sha256:')
    ? aar.outputHash
    : aidHashPrefixed(aar.outputHash);

  return {
    protocol: 'AID',
    version: '1.0.0',
    receiptId: `aar-${aar.receiptId}`,
    timestamp: aar.timestamp,
    payer: {
      did: aar.agentDid,
    },
    provider: {
      did: aar.metadata?.providerDid as string || 'unknown',
    },
    service: {
      id: aar.action,
      type: inferServiceType(aar.action),
      inputHash,
      resultHash,
    },
    execution: {
      success: aar.success,
      durationMs: aar.durationMs,
    },
    trust: {
      merkleRoot: null, // External receipts have no Merkle anchor
      merkleProof: [],
      feedbackUrl: null,
    },
  };
}

// ─── AID → AAR Conversion ───────────────────────────────────────────────────

/**
 * Convert an AID receipt to AAR format.
 *
 * Used when exporting AID receipts to AAR-compatible platforms,
 * making AID trust history portable to the BotIndex ecosystem.
 */
export function aidToAar(aid: AIDReceipt): AARReceipt {
  // Downgrade hash to SHA-256 prefix for AAR compatibility
  const inputHash = aid.service.inputHash.startsWith('sha256:')
    ? `sha256:${aid.service.inputHash.split(':')[1]?.slice(0, 64) || ''}`
    : aid.service.inputHash;

  const outputHash = aid.service.resultHash.startsWith('sha256:')
    ? `sha256:${aid.service.resultHash.split(':')[1]?.slice(0, 64) || ''}`
    : aid.service.resultHash;

  return {
    receiptId: aid.receiptId.replace('aar-', ''),
    agentDid: aid.payer.did,
    action: aid.service.id,
    timestamp: aid.timestamp,
    inputHash,
    outputHash,
    success: aid.execution?.success ?? true,
    durationMs: aid.execution?.durationMs ?? 0,
    signature: aid.payer.signature || '',
    metadata: {
      providerDid: aid.provider.did,
      protocol: 'AID',
      aidVersion: aid.version,
      trustScore: aid.payer.trustScore,
      merkleRoot: aid.trust?.merkleRoot,
      paymentAmount: aid.payment?.amount,
      paymentCurrency: aid.payment?.currency,
    },
  };
}

// ─── Batch Conversion ───────────────────────────────────────────────────────

/**
 * Convert multiple AAR receipts to AID format.
 * Filters out invalid receipts and returns conversion stats.
 */
export function batchAarToAid(receipts: AARReceipt[]): {
  converted: AIDReceipt[];
  failed: number;
  total: number;
} {
  const converted: AIDReceipt[] = [];
  let failed = 0;

  for (const aar of receipts) {
    try {
      if (!aar.receiptId || !aar.agentDid || !aar.timestamp) {
        failed++;
        continue;
      }
      converted.push(aarToAid(aar));
    } catch {
      failed++;
    }
  }

  return { converted, failed, total: receipts.length };
}

/**
 * Convert multiple AID receipts to AAR format.
 */
export function batchAidToAar(receipts: AIDReceipt[]): {
  converted: AARReceipt[];
  failed: number;
  total: number;
} {
  const converted: AARReceipt[] = [];
  let failed = 0;

  for (const aid of receipts) {
    try {
      converted.push(aidToAar(aid));
    } catch {
      failed++;
    }
  }

  return { converted, failed, total: receipts.length };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate an AAR receipt has all required fields.
 */
export function validateAarReceipt(receipt: unknown): receipt is AARReceipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
  return (
    typeof r.receiptId === 'string' &&
    typeof r.agentDid === 'string' &&
    typeof r.action === 'string' &&
    typeof r.timestamp === 'string' &&
    typeof r.success === 'boolean'
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function inferServiceType(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('query') || lower.includes('fetch') || lower.includes('get')) return 'data_query';
  if (lower.includes('swap') || lower.includes('trade')) return 'defi_action';
  if (lower.includes('send') || lower.includes('transfer')) return 'transfer';
  if (lower.includes('analyze') || lower.includes('compute')) return 'compute';
  return 'skill_invoke';
}
