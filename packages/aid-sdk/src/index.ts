/**
 * @aidprotocol/sdk — AID Protocol SDK
 *
 * Trust-scored agent commerce in 3 lines of code.
 *
 * @example
 * ```typescript
 * import { AID } from '@aidprotocol/sdk';
 *
 * const agent = await AID.connect();       // auto-provisions AID if new
 * const data = await agent.query('sol-price', { token: 'SOL' });
 * console.log(data.price);                 // 145.20
 * ```
 *
 * @example With existing wallet
 * ```typescript
 * const agent = await AID.connect({
 *   privateKeySeed: process.env.AID_PRIVATE_KEY,
 * });
 * const trust = await agent.getTrust();
 * console.log(trust.score, trust.verdict);  // 87 'trusted'
 * ```
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'crypto';
import { randomBytes } from 'crypto';
import { getTrustVerdict } from '@aidprotocol/trust-compute';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AIDConfig {
  /** Ed25519 private key seed (64 hex chars). If omitted, auto-provisions a new AID. */
  privateKeySeed?: string;
  /** Display name for auto-provisioning */
  name?: string;
  /** AID Platform API URL */
  apiUrl?: string;
  /** Cache trust lookups for this many seconds */
  cacheTtlSeconds?: number;
}

export interface AIDAgent {
  /** Agent's DID (did:key:z...) */
  did: string;
  /** Query a skill by name */
  query: (skillId: string, variables?: Record<string, unknown>) => Promise<any>;
  /** Get this agent's trust score */
  getTrust: () => Promise<TrustInfo>;
  /** Look up another agent's trust score */
  lookupTrust: (did: string) => Promise<TrustInfo>;
  /** Submit feedback on a receipt */
  feedback: (receiptId: string, outcome: 'success' | 'partial' | 'failure', qualityScore?: number) => Promise<void>;
  /** Get heartbeat (platform status + pricing) */
  heartbeat: () => Promise<any>;
  /** Sign a request body (for manual API calls) */
  sign: (method: string, path: string, body: string) => AIDHeaders;
}

export interface TrustInfo {
  did: string;
  score: number;
  verdict: string;
  attestationCount: number;
  discount: number;
  settlementMode: string;
}

export interface AIDHeaders {
  'X-AID-DID': string;
  'X-AID-PROOF': string;
  'X-AID-TIMESTAMP': string;
  'X-AID-NONCE': string;
}

// ─── AID Client ─────────────────────────────────────────────────────────────

class AIDClient implements AIDAgent {
  readonly did: string;
  private privateKey: ReturnType<typeof createPrivateKey>;
  private apiUrl: string;
  private cacheTtl: number;
  private trustCache: Map<string, { info: TrustInfo; expiresAt: number }> = new Map();

  constructor(did: string, privateKey: ReturnType<typeof createPrivateKey>, apiUrl: string, cacheTtl: number) {
    this.did = did;
    this.privateKey = privateKey;
    this.apiUrl = apiUrl;
    this.cacheTtl = cacheTtl;
  }

  sign(method: string, path: string, body: string): AIDHeaders {
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(16).toString('hex');

    const bodyHash = createHash('sha384').update(body).digest('hex');
    const signingString = `${this.did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
    const signatureInput = createHash('sha384').update(signingString).digest();
    const signature = cryptoSign(null, signatureInput, this.privateKey).toString('base64url');

    return {
      'X-AID-DID': this.did,
      'X-AID-PROOF': signature,
      'X-AID-TIMESTAMP': timestamp,
      'X-AID-NONCE': nonce,
    };
  }

  async query(skillId: string, variables?: Record<string, unknown>): Promise<any> {
    const path = `/v1/skills/${encodeURIComponent(skillId)}/invoke`;
    const body = JSON.stringify({ variables: variables || {} });
    const headers = this.sign('POST', path, body);

    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `AID query failed: ${res.status}`);
    }

    return res.json();
  }

  async getTrust(): Promise<TrustInfo> {
    return this.lookupTrust(this.did);
  }

  async lookupTrust(did: string): Promise<TrustInfo> {
    // Check cache
    const cached = this.trustCache.get(did);
    if (cached && Date.now() < cached.expiresAt) return cached.info;

    const res = await fetch(`${this.apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { did, score: 0, verdict: 'new', attestationCount: 0, discount: 0, settlementMode: 'immediate' };
    }

    const data = await res.json() as any;
    const score = data.trustScore ?? data.score ?? 0;
    const verdictResult = getTrustVerdict(score);

    const info: TrustInfo = {
      did,
      score,
      verdict: verdictResult.verdict,
      attestationCount: data.attestationCount ?? 0,
      discount: verdictResult.discount,
      settlementMode: verdictResult.settlementMode,
    };

    this.trustCache.set(did, { info, expiresAt: Date.now() + this.cacheTtl * 1000 });
    return info;
  }

  async feedback(receiptId: string, outcome: 'success' | 'partial' | 'failure', qualityScore?: number): Promise<void> {
    const path = '/aid/feedback';
    const body = JSON.stringify({ receiptId, outcome, qualityScore });
    const headers = this.sign('POST', path, body);

    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Feedback failed: ${res.status}`);
    }
  }

  async heartbeat(): Promise<any> {
    const res = await fetch(`${this.apiUrl}/aid/heartbeat`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Connect to the AID Protocol.
 *
 * If `privateKeySeed` is provided, uses existing identity.
 * If omitted, auto-provisions a new AID via POST /aid/provision.
 */
async function connect(config: AIDConfig = {}): Promise<AIDAgent> {
  const apiUrl = config.apiUrl || 'https://api.claw-net.org';
  const cacheTtl = config.cacheTtlSeconds || 300;

  if (config.privateKeySeed) {
    // Use existing key
    const seed = Buffer.from(config.privateKeySeed, 'hex');
    if (seed.length !== 32) throw new Error('privateKeySeed must be 64 hex chars (32 bytes)');

    const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
    const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
    const privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });

    // Derive DID from public key
    const pubKey = require('crypto').createPublicKey(privateKey);
    const spki = pubKey.export({ type: 'spki', format: 'der' });
    const rawPub = spki.subarray(12); // skip SPKI header

    // Encode as did:key multibase
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), rawPub]);
    const did = `did:key:z${base58btcEncode(multicodec)}`;

    return new AIDClient(did, privateKey, apiUrl, cacheTtl);
  }

  // Auto-provision
  const name = config.name || `agent-${randomBytes(4).toString('hex')}`;
  const res = await fetch(`${apiUrl}/aid/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AID-NEW': name },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `AID provisioning failed: ${res.status}`);
  }

  const data = await res.json() as any;

  // Build private key from returned seed
  const seed = Buffer.from(data.privateKeySeed, 'hex');
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  const privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });

  return new AIDClient(data.did, privateKey, apiUrl, cacheTtl);
}

// ─── Base58btc Encoding ─────────────────────────────────────────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Buffer): string {
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
    result += B58_ALPHABET[digits[i]];
  }
  return result;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const AID = { connect };
export default AID;
