/**
 * verifiable-intent.ts — Map AID trust as a Verifiable Intent signal (Optimization 13)
 *
 * Mastercard's Verifiable Intent (VI) is a cryptographic proof of consumer
 * authorization for agent transactions (open-sourced March 5, 2026).
 *
 * VI answers: "WHO authorized this transaction?"
 * AID answers: "IS this agent trustworthy?"
 *
 * This module maps AID trust scores into VI-compatible credential format so that:
 *   1. VI-aware merchants can check agent trust alongside authorization
 *   2. AID trust scores become a data source for VI authorization decisions
 *   3. AID is complementary to VI, not competitive
 *
 * VI credential format (W3C VC with Selective Disclosure):
 *   - Issuer: AID Platform (did:web:api.claw-net.org)
 *   - Subject: agent DID
 *   - Claims: trust score, verdict, attestation count, capabilities
 *
 * Per AIDplan Section 15.4: "Identity tells you WHO. Authorization tells you
 * WHAT they're allowed to do. Trust tells you WHETHER they're worth doing
 * business with."
 *
 * @license MIT
 */

import crypto from 'crypto';
import { AID_HASH_ALGORITHM } from './crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

/** AID Trust Credential — W3C VC format compatible with Verifiable Intent */
export interface AidTrustCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: {
    id: string; // agent DID
    trustScore: number;
    trustVerdict: string;
    attestationCount: number;
    capabilities: string[];
    verified: boolean;
    /** Selective disclosure: these fields can be individually revealed */
    selectiveDisclosure: {
      available: string[];
      hash: string;
    };
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

/** VI-compatible authorization check result */
export interface ViTrustSignal {
  /** Whether the agent meets the merchant's trust requirements */
  authorized: boolean;
  /** Trust verdict (from AID scoring) */
  trustVerdict: string;
  /** Confidence level (0-1) based on attestation depth */
  confidence: number;
  /** Risk level for the merchant's decision */
  riskLevel: 'low' | 'medium' | 'high' | 'very_high';
  /** Recommendation for the merchant */
  recommendation: string;
  /** The credential if authorization passed */
  credential?: AidTrustCredential;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PLATFORM_DID = 'did:web:api.claw-net.org';
const CREDENTIAL_EXPIRY_DAYS = 30;

// ─── Platform signing key ────────────────────────────────────────────────────

let _privateKey: crypto.KeyObject | null = null;

function ensurePrivateKey(): crypto.KeyObject {
  if (_privateKey) return _privateKey;
  const { derivePlatformSeed } = require('../utils/ed25519-signer');
  const seed = derivePlatformSeed('ed25519-platform');
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  _privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  return _privateKey;
}

// ─── Credential Generation ──────────────────────────────────────────────────

/**
 * Generate a W3C VC trust credential for a given agent.
 * This credential can be presented alongside a Verifiable Intent proof.
 *
 * @param did - Agent DID
 * @param trustScore - Current trust score (0-100)
 * @param verdict - Trust verdict
 * @param attestationCount - Number of attestations
 * @param capabilities - List of capability categories
 */
export function generateTrustCredential(
  did: string,
  trustScore: number,
  verdict: string,
  attestationCount: number,
  capabilities: string[] = [],
): AidTrustCredential {
  const now = new Date();
  const expiry = new Date(now.getTime() + CREDENTIAL_EXPIRY_DAYS * 86_400_000);

  // Selective disclosure hash — hash of all disclosable fields
  const disclosableFields = ['trustScore', 'trustVerdict', 'attestationCount', 'capabilities', 'verified'];
  const sdHash = crypto.createHash(AID_HASH_ALGORITHM)
    .update(JSON.stringify({ trustScore, verdict, attestationCount, capabilities, verified: trustScore >= 40 }))
    .digest('hex');

  const credentialSubject = {
    id: did,
    trustScore,
    trustVerdict: verdict,
    attestationCount,
    capabilities,
    verified: trustScore >= 40,
    selectiveDisclosure: {
      available: disclosableFields,
      hash: sdHash,
    },
  };

  // Sign the credential
  const credentialHash = crypto.createHash(AID_HASH_ALGORITHM)
    .update(JSON.stringify(credentialSubject))
    .update(now.toISOString())
    .digest();

  const signature = crypto.sign(null, credentialHash, ensurePrivateKey());

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://aidprotocol.org/credentials/trust/v1',
    ],
    type: ['VerifiableCredential', 'AidTrustCredential'],
    issuer: PLATFORM_DID,
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject,
    proof: {
      type: 'Ed25519Signature2020',
      created: now.toISOString(),
      verificationMethod: `${PLATFORM_DID}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: signature.toString('base64url'),
    },
  };
}

// ─── VI Trust Signal ────────────────────────────────────────────────────────

/**
 * Generate a VI-compatible trust signal for a merchant's authorization decision.
 *
 * Merchants using Verifiable Intent can call this to check whether an agent
 * meets their trust requirements before processing a transaction.
 *
 * @param did - Agent DID
 * @param trustScore - Current trust score
 * @param verdict - Trust verdict
 * @param attestationCount - Number of attestations
 * @param merchantMinScore - Merchant's minimum trust requirement (default: 40)
 * @param capabilities - Agent capabilities
 */
export function generateViTrustSignal(
  did: string,
  trustScore: number,
  verdict: string,
  attestationCount: number,
  merchantMinScore: number = 40,
  capabilities: string[] = [],
): ViTrustSignal {
  const authorized = trustScore >= merchantMinScore;

  // Confidence based on attestation depth
  let confidence: number;
  if (attestationCount >= 1000) confidence = 0.95;
  else if (attestationCount >= 100) confidence = 0.80;
  else if (attestationCount >= 10) confidence = 0.60;
  else if (attestationCount >= 1) confidence = 0.40;
  else confidence = 0.10;

  // Risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'very_high';
  if (trustScore >= 80 && attestationCount >= 100) riskLevel = 'low';
  else if (trustScore >= 60 && attestationCount >= 10) riskLevel = 'medium';
  else if (trustScore >= 40) riskLevel = 'high';
  else riskLevel = 'very_high';

  // Recommendation
  let recommendation: string;
  if (riskLevel === 'low') {
    recommendation = 'Proceed with standard processing. Agent has strong track record.';
  } else if (riskLevel === 'medium') {
    recommendation = 'Proceed with monitoring. Agent has moderate track record.';
  } else if (riskLevel === 'high') {
    recommendation = 'Require immediate settlement. Agent has limited track record.';
  } else {
    recommendation = 'Require prepayment or reject. Agent has no meaningful track record.';
  }

  const signal: ViTrustSignal = {
    authorized,
    trustVerdict: verdict,
    confidence,
    riskLevel,
    recommendation,
  };

  if (authorized) {
    signal.credential = generateTrustCredential(did, trustScore, verdict, attestationCount, capabilities);
  }

  return signal;
}

/**
 * Verify an AID Trust Credential's signature.
 * Third parties use this to validate credentials offline.
 */
export function verifyTrustCredential(
  credential: AidTrustCredential,
  platformPublicKeyJwk: any,
): boolean {
  try {
    const pubKey = crypto.createPublicKey({ key: platformPublicKeyJwk, format: 'jwk' });

    const credentialHash = crypto.createHash(AID_HASH_ALGORITHM)
      .update(JSON.stringify(credential.credentialSubject))
      .update(credential.proof.created)
      .digest();

    const sigBytes = Buffer.from(credential.proof.proofValue, 'base64url');
    return crypto.verify(null, credentialHash, pubKey, sigBytes);
  } catch {
    return false;
  }
}
