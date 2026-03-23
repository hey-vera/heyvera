/**
 * @aidprotocol/solana-trust — AID trust scoring for Solana Agent Registry
 *
 * Maps AID trust scores to Solana's native Ed25519 identity model.
 * On Solana, the Ed25519 AID key IS the payment key — no dual-key needed.
 *
 * Features:
 *   - Ed25519 native DID ↔ Solana pubkey mapping
 *   - Trust score resolution for Solana agents
 *   - Trust-gated access control for Solana programs
 *   - Compatible with Quantu AI's Solana Agent Registry
 *
 * @example
 * ```typescript
 * import { SolanaTrust } from '@aidprotocol/solana-trust';
 *
 * const trust = new SolanaTrust({ apiUrl: 'https://api.claw-net.org' });
 *
 * // Look up trust by Solana public key
 * const score = await trust.getScore('AqYkp3...');
 * console.log(score.trustScore); // 87
 * console.log(score.verdict);    // 'trusted'
 *
 * // Check if agent meets threshold
 * const ok = await trust.meetsThreshold('AqYkp3...', 60);
 * ```
 */

import { getTrustVerdict } from '@aidprotocol/trust-compute';
import type { TrustVerdictResult } from '@aidprotocol/trust-compute';

export type { TrustVerdictResult };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SolanaTrustConfig {
  /** AID trust API URL (default: https://api.claw-net.org) */
  apiUrl?: string;
  /** Cache TTL in seconds (default: 300) */
  cacheTtlSeconds?: number;
}

export interface TrustResult {
  /** Solana public key */
  solanaPublicKey: string;
  /** AID DID (did:key:z...) — derived from Ed25519 pubkey */
  did: string | null;
  /** Trust score (0-100) */
  trustScore: number;
  /** Trust verdict */
  verdict: string;
  /** Discount for trust-gated pricing */
  discount: number;
  /** Whether the score is from cache */
  cached: boolean;
  /** Attestation count */
  attestationCount: number;
}

// ─── Base58 Encoding (Solana standard) ──────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const c of s) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 character: ${c}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ─── DID ↔ Solana Key Mapping ───────────────────────────────────────────────

/**
 * Convert a Solana Ed25519 public key to a did:key DID.
 *
 * Solana pubkeys are raw Ed25519 public keys (32 bytes, base58-encoded).
 * did:key uses multicodec prefix 0xed01 + base58btc encoding.
 */
export function solanaPubkeyToDid(solanaPublicKey: string): string {
  const pubkeyBytes = base58Decode(solanaPublicKey);
  if (pubkeyBytes.length !== 32) {
    throw new Error(`Invalid Solana public key length: ${pubkeyBytes.length} (expected 32)`);
  }

  // did:key multicodec: 0xed (Ed25519) + 0x01 (public key)
  const multicodec = new Uint8Array([0xed, 0x01, ...pubkeyBytes]);
  return `did:key:z${base58Encode(multicodec)}`;
}

/**
 * Extract Solana public key from a did:key DID.
 */
export function didToSolanaPubkey(did: string): string {
  if (!did.startsWith('did:key:z')) {
    throw new Error('Not a did:key DID');
  }
  const decoded = base58Decode(did.slice('did:key:z'.length));
  if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Not an Ed25519 did:key');
  }
  return base58Encode(decoded.subarray(2));
}

// ─── Trust Cache ────────────────────────────────────────────────────────────

interface CacheEntry { result: TrustResult; expiresAt: number }
const cache = new Map<string, CacheEntry>();

function getCached(key: string): TrustResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return { ...entry.result, cached: true };
}

function setCache(key: string, result: TrustResult, ttlMs: number): void {
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
  if (cache.size > 10_000) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// ─── Main Class ─────────────────────────────────────────────────────────────

export class SolanaTrust {
  private apiUrl: string;
  private cacheTtlMs: number;

  constructor(config: SolanaTrustConfig = {}) {
    this.apiUrl = config.apiUrl || 'https://api.claw-net.org';
    this.cacheTtlMs = (config.cacheTtlSeconds || 300) * 1000;
  }

  /**
   * Get trust score for a Solana public key.
   */
  async getScore(solanaPublicKey: string): Promise<TrustResult> {
    const cached = getCached(solanaPublicKey);
    if (cached) return cached;

    let did: string | null = null;
    try {
      did = solanaPubkeyToDid(solanaPublicKey);
    } catch {
      return this.emptyResult(solanaPublicKey);
    }

    try {
      const res = await fetch(`${this.apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return this.emptyResult(solanaPublicKey, did);

      const data = await res.json() as any;
      const score = data.trustScore ?? data.score ?? 0;
      const verdictResult = getTrustVerdict(score);

      const result: TrustResult = {
        solanaPublicKey,
        did,
        trustScore: score,
        verdict: verdictResult.verdict,
        discount: verdictResult.discount,
        cached: false,
        attestationCount: data.attestationCount ?? 0,
      };

      setCache(solanaPublicKey, result, this.cacheTtlMs);
      return result;
    } catch {
      return this.emptyResult(solanaPublicKey, did);
    }
  }

  /**
   * Check if a Solana agent meets a minimum trust threshold.
   */
  async meetsThreshold(solanaPublicKey: string, minScore: number): Promise<boolean> {
    const result = await this.getScore(solanaPublicKey);
    return result.trustScore >= minScore;
  }

  /**
   * Get trust-gated price for a Solana agent.
   */
  async getTrustGatedPrice(solanaPublicKey: string, basePriceLamports: number): Promise<{
    originalPrice: number;
    adjustedPrice: number;
    discount: number;
    verdict: string;
  }> {
    const result = await this.getScore(solanaPublicKey);
    const adjustedPrice = Math.round(basePriceLamports * (1 - result.discount));
    return {
      originalPrice: basePriceLamports,
      adjustedPrice,
      discount: result.discount,
      verdict: result.verdict,
    };
  }

  /** Clear the trust cache */
  clearCache(): void { cache.clear(); }

  private emptyResult(solanaPublicKey: string, did?: string | null): TrustResult {
    return {
      solanaPublicKey, did: did ?? null,
      trustScore: 0, verdict: 'new', discount: 0,
      cached: false, attestationCount: 0,
    };
  }
}
