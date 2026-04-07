/**
 * @clawnet/sense-observer — external Soma birth-certificate verifier.
 *
 * The Sense side of Soma's heart/sense separation: hearts SIGN data, senses
 * VERIFY signatures. A sense MUST run in a different process/machine/org
 * than the heart it's verifying, or its verdict is meaningless ("never
 * self-verify" — the observer must be a separate party).
 *
 * This package wraps the minimal cryptographic checks needed to verify a
 * birth certificate without pulling in all of soma-heart's runtime.
 *
 * Usage:
 *   import { verifyBirthCert } from '@clawnet/sense-observer';
 *   const result = verifyBirthCert({ cert, data, publicKey });
 *   if (!result.valid) console.error(result.reasons);
 */

import nacl from 'tweetnacl';
import { createHash } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────

export type DataSourceType = 'agent' | 'api' | 'human' | 'sensor' | 'file';
export type TrustTier = 'dual-signed' | 'single-signed' | 'unsigned';

export interface DataSource {
  type: DataSourceType;
  identifier: string;
  heartVerified: boolean;
}

export interface BirthCertificate {
  dataHash: string;
  source: DataSource;
  bornAt: number;
  bornThrough: string;
  bornInSession: string;
  parentCertificates: string[];
  receiverSignature: string;
  sourceSignature: string | null;
  trustTier: TrustTier;
}

export interface VerifyInput {
  /** The birth certificate to verify. */
  cert: BirthCertificate;
  /** The raw data the certificate claims to seal. Optional — without it we skip integrity check. */
  data?: string;
  /** Public key of the receiving heart (the one that signed `receiverSignature`). Hex, base64, or Uint8Array. */
  publicKey: string | Uint8Array;
  /** Public key of the source heart (if dual-signed). Optional. */
  sourcePublicKey?: string | Uint8Array;
  /** Reject if cert is older than this many seconds. Default: no limit. */
  maxAgeSeconds?: number;
}

export interface VerifyResult {
  valid: boolean;
  /** List of passed checks. */
  checks: string[];
  /** Human-readable reasons for failure (empty when valid). */
  reasons: string[];
  /** The cert's trust tier as observed. */
  trustTier: TrustTier;
  /** Age of the certificate in seconds at verify time. */
  ageSeconds: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function decodeKey(key: string | Uint8Array): Uint8Array {
  if (key instanceof Uint8Array) return key;
  // Try hex first (64 chars for ed25519 public key), fall back to base64
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return new Uint8Array(Buffer.from(key, 'hex'));
  }
  return new Uint8Array(Buffer.from(key, 'base64'));
}

function decodeSignature(sig: string): Uint8Array {
  // Signatures from soma-heart are base64
  return new Uint8Array(Buffer.from(sig, 'base64'));
}

/**
 * Reconstruct the canonical signed payload for a birth cert's receiver signature.
 * Matches soma-heart's canonicalizeCertContent — alphabetical keys, source
 * nested as { heartVerified, identifier, type }, parentCertificates sorted,
 * trustTier included.
 */
function canonicalReceiverPayload(cert: BirthCertificate): Uint8Array {
  const canonical = JSON.stringify({
    bornAt: cert.bornAt,
    bornInSession: cert.bornInSession,
    bornThrough: cert.bornThrough,
    dataHash: cert.dataHash,
    parentCertificates: [...cert.parentCertificates].sort(),
    source: {
      heartVerified: cert.source.heartVerified,
      identifier: cert.source.identifier,
      type: cert.source.type,
    },
    trustTier: cert.trustTier,
  });
  return new Uint8Array(Buffer.from(canonical, 'utf8'));
}

/**
 * Reconstruct the DataProvenance payload that the source heart signs.
 * Matches soma-heart's canonicalizeProvenance — alphabetical keys.
 */
function canonicalSourcePayload(cert: BirthCertificate): Uint8Array {
  const canonical = JSON.stringify({
    dataHash: cert.dataHash,
    receiverDid: cert.bornThrough,
    sourceDid: cert.source.identifier,
    timestamp: cert.bornAt,
  });
  return new Uint8Array(Buffer.from(canonical, 'utf8'));
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Verify a birth certificate. Runs ALL applicable checks and returns a
 * structured verdict. Never throws on verification failure — callers
 * inspect result.valid + result.reasons.
 */
export function verifyBirthCert(input: VerifyInput): VerifyResult {
  const { cert, data, publicKey, sourcePublicKey, maxAgeSeconds } = input;
  const checks: string[] = [];
  const reasons: string[] = [];
  const ageSeconds = Math.floor((Date.now() - cert.bornAt) / 1000);

  // Shape check
  if (!cert.dataHash || !cert.receiverSignature || !cert.bornThrough) {
    reasons.push('certificate missing required fields (dataHash, receiverSignature, bornThrough)');
    return { valid: false, checks, reasons, trustTier: cert.trustTier, ageSeconds };
  }
  checks.push('shape: required fields present');

  // Age check
  if (maxAgeSeconds !== undefined && ageSeconds > maxAgeSeconds) {
    reasons.push(`certificate age ${ageSeconds}s exceeds maxAgeSeconds=${maxAgeSeconds}`);
  } else if (maxAgeSeconds !== undefined) {
    checks.push(`age: ${ageSeconds}s ≤ ${maxAgeSeconds}s`);
  }

  // Future-dated check
  if (cert.bornAt > Date.now() + 60_000) {
    reasons.push(`certificate bornAt ${new Date(cert.bornAt).toISOString()} is in the future`);
  } else {
    checks.push('timestamp: not future-dated');
  }

  // Data integrity check (only if data was provided)
  if (data !== undefined) {
    const actual = sha256Hex(data);
    if (actual !== cert.dataHash) {
      reasons.push(`data integrity: hash mismatch — cert says ${cert.dataHash.slice(0, 12)}…, data hashes to ${actual.slice(0, 12)}…`);
    } else {
      checks.push('data integrity: hash matches');
    }
  } else {
    checks.push('data integrity: skipped (no data provided)');
  }

  // Receiver signature verification
  try {
    const receiverPubKey = decodeKey(publicKey);
    if (receiverPubKey.length !== 32) {
      reasons.push(`receiver publicKey has wrong length ${receiverPubKey.length} (expected 32)`);
    } else {
      const payload = canonicalReceiverPayload(cert);
      const sigBytes = decodeSignature(cert.receiverSignature);
      const ok = nacl.sign.detached.verify(payload, sigBytes, receiverPubKey);
      if (!ok) {
        reasons.push('receiver signature: verification failed — cert not signed by provided publicKey');
      } else {
        checks.push('receiver signature: verified');
      }
    }
  } catch (err) {
    reasons.push(`receiver signature: decode error — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Source signature verification (dual-signed only)
  if (cert.trustTier === 'dual-signed') {
    if (!cert.sourceSignature) {
      reasons.push('trustTier=dual-signed but sourceSignature is null');
    } else if (!sourcePublicKey) {
      checks.push('source signature: skipped (no sourcePublicKey provided — cannot verify)');
    } else {
      try {
        const sourcePubKey = decodeKey(sourcePublicKey);
        const payload = canonicalSourcePayload(cert);
        const sigBytes = decodeSignature(cert.sourceSignature);
        const ok = nacl.sign.detached.verify(payload, sigBytes, sourcePubKey);
        if (!ok) {
          reasons.push('source signature: verification failed');
        } else {
          checks.push('source signature: verified (dual-signed)');
        }
      } catch (err) {
        reasons.push(`source signature: decode error — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (cert.trustTier === 'single-signed') {
    checks.push('source signature: N/A (trustTier=single-signed)');
  }

  return {
    valid: reasons.length === 0,
    checks,
    reasons,
    trustTier: cert.trustTier,
    ageSeconds,
  };
}

/**
 * Verify a chain of birth certificates. Each cert MUST list its parent's
 * sha256(receiverSignature) in parentCertificates — matching soma-heart's
 * convention (see birth-certificate.js:verifyBirthCertificateChain).
 * The chain is walked root→leaf.
 */
export function verifyBirthCertChain(
  chain: BirthCertificate[],
  publicKeys: Map<string, string | Uint8Array>,
): { valid: boolean; brokenAt: number; reason: string } {
  if (chain.length === 0) return { valid: false, brokenAt: 0, reason: 'empty chain' };

  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];
    const key = publicKeys.get(cert.bornThrough);
    if (!key) {
      return { valid: false, brokenAt: i, reason: `no publicKey for heart ${cert.bornThrough}` };
    }
    const result = verifyBirthCert({ cert, publicKey: key });
    if (!result.valid) {
      return { valid: false, brokenAt: i, reason: result.reasons.join('; ') };
    }
    // Parent-pointer consistency (skip for root)
    // soma-heart links via sha256(parent.receiverSignature), NOT parent.dataHash
    if (i > 0) {
      const parent = chain[i - 1];
      const parentRef = createHash('sha256').update(parent.receiverSignature).digest('hex');
      if (!cert.parentCertificates.includes(parentRef)) {
        return {
          valid: false,
          brokenAt: i,
          reason: `cert[${i}] does not reference sha256(parent cert[${i - 1}].receiverSignature)`,
        };
      }
    }
  }
  return { valid: true, brokenAt: -1, reason: 'all verified' };
}
