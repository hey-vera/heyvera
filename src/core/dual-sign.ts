/**
 * dual-sign.ts — Dual-Signed Soma Protocol
 *
 * When an upstream x402 provider runs Soma heart, their responses include
 * X-Soma-* headers (birth certificate). ClawNet validates the provider's
 * certificate, then creates its own platform certificate wrapping it.
 *
 * The result is a dual-signed provenance chain:
 *
 *   Data Source (Helius, X API, etc.)
 *       ↓
 *   Provider (runs Soma heart) → signs birth cert #1
 *       ↓
 *   ClawNet (runs Soma heart) → validates cert #1, signs birth cert #2
 *       ↓
 *   Consumer → verifies both certs independently
 *
 * This creates an unbroken chain of custody from data source → consumer.
 * Nobody in x402 has this. Every other service is "trust me bro."
 *
 * Verification: any client can verify both signatures using only the
 * public keys from each party's /.well-known/soma.json endpoint.
 */

import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import { logger } from '../utils/logger';
import { somaHash } from '../utils/crypto-agility';
import { getEd25519PublicKeyRaw, derivePlatformSeed } from '../utils/ed25519-signer';
import { env } from '../config/index';

// ─���─ Types ──────────────────────────────────────────────────────────────────

/** Provider's birth certificate extracted from upstream X-Soma-* headers */
export interface ProviderCertificate {
  protocol: string;
  dataHash: string;
  signature: string;
  heartbeatIndex: number;
  publicKey: string;
  genomeHash?: string;
  discoveryUrl?: string;
}

/** Combined dual-sign result after platform co-signs */
export interface DualSignResult {
  /** Provider's original birth certificate */
  provider: ProviderCertificate;
  /** Platform's co-signature over: provider cert + response data */
  platform: {
    dataHash: string;
    signature: string;
    heartbeatIndex: number | null;
    publicKey: string;
  };
  /** Whether the provider's signature was cryptographically verified */
  providerVerified: boolean;
  /** Chain hash binding both certificates together */
  chainHash: string;
  /** Timestamp of dual-sign creation */
  timestamp: string;
}

// ─── Extract provider cert from HTTP headers ────────────────────────────────

/**
 * Extract a ProviderCertificate from upstream response headers.
 * Returns null if the required Soma headers are missing.
 */
export function extractProviderCert(headers: Record<string, string | undefined>): ProviderCertificate | null {
  const dataHash = headers['x-soma-data-hash'] || headers['X-Soma-Data-Hash'];
  const signature = headers['x-soma-signature'] || headers['X-Soma-Signature'];
  const publicKey = headers['x-soma-public-key'] || headers['X-Soma-Public-Key'];
  const heartbeatIndex = headers['x-soma-heartbeat-index'] || headers['X-Soma-Heartbeat-Index'];
  const protocol = headers['x-soma-protocol'] || headers['X-Soma-Protocol'];

  if (!dataHash || !signature || !publicKey) return null;

  return {
    protocol: protocol ?? 'soma/1.0',
    dataHash,
    signature,
    heartbeatIndex: heartbeatIndex ? parseInt(heartbeatIndex, 10) : 0,
    publicKey,
    genomeHash: headers['x-soma-genome-hash'] || headers['X-Soma-Genome-Hash'],
    discoveryUrl: headers['x-soma-discovery'] || headers['X-Soma-Discovery'],
  };
}

// ─── Verify provider's signature ────────────────────────────────────────────

/**
 * Verify a provider's Ed25519 birth certificate signature.
 * Returns true if the signature is valid for the given data hash and public key.
 */
const HEX_RE = /^[0-9a-f]+$/i;

export function verifyProviderCert(cert: ProviderCertificate): boolean {
  try {
    // Validate hex format before Buffer.from — prevents silent garbled bytes (audit M7)
    if (!HEX_RE.test(cert.dataHash) || !HEX_RE.test(cert.signature) || !HEX_RE.test(cert.publicKey)) {
      logger.warn('Provider cert contains non-hex fields — rejecting');
      return false;
    }
    const message = Buffer.from(cert.dataHash, 'hex');
    const sig = Buffer.from(cert.signature, 'hex');
    const pubKey = Buffer.from(cert.publicKey, 'hex');

    if (pubKey.length !== 32 || sig.length !== 64) {
      logger.warn({ pubKeyLen: pubKey.length, sigLen: sig.length }, 'Invalid provider cert key/sig length');
      return false;
    }

    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(sig),
      new Uint8Array(pubKey),
    );
  } catch (err) {
    logger.warn({ err }, 'Provider cert verification failed');
    return false;
  }
}

// ─── Platform co-sign ───────────────────────────────────────────────────────

/**
 * Get the platform's Ed25519 signing keypair (same seed as soma.ts and ed25519-signer.ts).
 */
function getPlatformKeyPair(): nacl.SignKeyPair {
  const seed = derivePlatformSeed('ed25519-platform');
  return nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
}

/**
 * Create a dual-signed provenance record.
 *
 * 1. Validates the provider's birth certificate (Ed25519 signature over data hash)
 * 2. Creates a chain hash binding: provider cert + response data hash
 * 3. Signs the chain hash with the platform's Ed25519 key
 * 4. Returns the combined dual-sign result
 *
 * Even if provider verification fails, the platform still co-signs (with
 * providerVerified=false) so the receipt is complete. Callers can decide
 * how to handle unverified provider certs.
 */
export function createDualSign(
  providerCert: ProviderCertificate,
  responseData: string | Buffer,
  heartbeatIndex?: number | null,
): DualSignResult | null {
  // Verify the provider's certificate — refuse to co-sign if verification fails (audit C2).
  // Previously the platform would co-sign with providerVerified=false, which gave consumers
  // a valid platform signature on unverified provider data.
  const providerVerified = verifyProviderCert(providerCert);

  if (!providerVerified) {
    logger.warn({
      providerKey: providerCert.publicKey.slice(0, 16) + '...',
      dataHash: providerCert.dataHash.slice(0, 16) + '...',
    }, 'Provider cert failed verification — refusing to dual-sign (single-sign only)');
    return null;
  }

  // Hash the response data as received by the platform
  const platformDataHash = somaHash(typeof responseData === 'string' ? responseData : responseData.toString('utf8'));

  // Chain hash: binds provider cert + platform observation together
  // This proves the platform received exactly this provider cert for exactly this data
  // Uses pipe delimiter — all fields are hex so pipe cannot appear naturally (audit L1)
  const chainPayload = [
    providerCert.dataHash,
    providerCert.signature,
    providerCert.publicKey,
    platformDataHash,
    String(heartbeatIndex ?? 0),
  ].join('|');
  const chainHash = somaHash(chainPayload);

  // Platform signs the chain hash
  const keyPair = getPlatformKeyPair();
  const chainHashBytes = Buffer.from(chainHash, 'hex');
  const platformSignature = Buffer.from(
    nacl.sign.detached(new Uint8Array(chainHashBytes), keyPair.secretKey),
  ).toString('hex');

  const platformPublicKey = Buffer.from(keyPair.publicKey).toString('hex');

  return {
    provider: providerCert,
    platform: {
      dataHash: platformDataHash,
      signature: platformSignature,
      heartbeatIndex: heartbeatIndex ?? null,
      publicKey: platformPublicKey,
    },
    providerVerified,
    chainHash,
    timestamp: new Date().toISOString(),
  };
}

// ─── Verify a dual-sign result (for consumers) ─────────────────────────────

/**
 * Verify both signatures in a dual-sign result.
 * Returns { provider: boolean, platform: boolean, chain: boolean }.
 *
 * A consumer needs only the two public keys (from /.well-known/soma.json)
 * to verify the entire chain offline.
 */
export function verifyDualSign(result: DualSignResult): {
  provider: boolean;
  platform: boolean;
  chain: boolean;
} {
  // Verify provider cert
  const providerOk = verifyProviderCert(result.provider);

  // Reconstruct and verify chain hash (pipe delimiter matches createDualSign)
  const chainPayload = [
    result.provider.dataHash,
    result.provider.signature,
    result.provider.publicKey,
    result.platform.dataHash,
    String(result.platform.heartbeatIndex ?? 0),
  ].join('|');
  const expectedChainHash = somaHash(chainPayload);
  const chainOk = expectedChainHash === result.chainHash;

  // Verify platform signature over chain hash
  let platformOk = false;
  try {
    const chainHashBytes = Buffer.from(result.chainHash, 'hex');
    const sig = Buffer.from(result.platform.signature, 'hex');
    const pubKey = Buffer.from(result.platform.publicKey, 'hex');

    platformOk = nacl.sign.detached.verify(
      new Uint8Array(chainHashBytes),
      new Uint8Array(sig),
      new Uint8Array(pubKey),
    );
  } catch {
    platformOk = false;
  }

  return { provider: providerOk, platform: platformOk, chain: chainOk };
}

// ─── Header helpers ─────────────────────────────────────────────────────────

/**
 * Set dual-sign response headers on a Hono context response.
 * These headers allow any x402 client to verify the dual-sign chain.
 */
export function setDualSignHeaders(
  headers: { set: (name: string, value: string) => void },
  result: DualSignResult,
): void {
  // Dual-sign meta
  headers.set('X-Soma-Dual-Signed', 'true');
  headers.set('X-Soma-Chain-Hash', result.chainHash);
  headers.set('X-Soma-Provider-Verified', String(result.providerVerified));

  // Provider cert headers (prefixed with Provider-)
  headers.set('X-Soma-Provider-Data-Hash', result.provider.dataHash);
  headers.set('X-Soma-Provider-Signature', result.provider.signature);
  headers.set('X-Soma-Provider-Public-Key', result.provider.publicKey);
  headers.set('X-Soma-Provider-Heartbeat-Index', String(result.provider.heartbeatIndex));
  if (result.provider.genomeHash) {
    headers.set('X-Soma-Provider-Genome-Hash', result.provider.genomeHash);
  }

  // Platform cert headers (standard X-Soma-* — backwards compatible)
  headers.set('X-Soma-Data-Hash', result.platform.dataHash);
  headers.set('X-Soma-Signature', result.platform.signature);
  headers.set('X-Soma-Public-Key', result.platform.publicKey);
  if (result.platform.heartbeatIndex != null) {
    headers.set('X-Soma-Heartbeat-Index', String(result.platform.heartbeatIndex));
  }
}
