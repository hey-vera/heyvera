/**
 * aid-provider-proof.ts — Add AID provider identity headers to responses
 *
 * When a request was verified by checkAidProof middleware (c.get('aidInfo') exists),
 * this response middleware adds:
 *   X-AID-PROVIDER-DID      — server's DID (mutual authentication)
 *   X-AID-PROVIDER-PROOF    — Ed25519 countersignature over response
 *   X-AID-TRUST-VERIFIED    — server's independently verified trust score for caller
 *
 * Per AID Protocol Specification Section 4.5:
 *   providerSignatureInput = SHA-256(providerDid + "\n" + receiptId + "\n" + timestamp + "\n" + SHA-256(responseBody))
 */

import type { MiddlewareHandler } from 'hono';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

const PLATFORM_DID = 'did:web:api.claw-net.org';

// ─── Cached platform private key (lazy init from ed25519-signer) ────────────

let _privateKey: crypto.KeyObject | null = null;

function ensurePrivateKey(): crypto.KeyObject {
  if (_privateKey) return _privateKey;
  const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
  const seed = crypto.createHash('sha256').update(secret).digest().subarray(0, 32);
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  _privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  return _privateKey;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export const aidProviderProof: MiddlewareHandler = async (c, next) => {
  await next();

  // Only sign if AID was verified on the request
  const aidInfo = c.get('aidInfo') as { did: string; trustScore: number; verdict: string } | undefined;
  if (!aidInfo) return;

  try {
    const body = await c.res.clone().text();
    const receiptId = `rcpt-${nanoid(16)}`;
    const timestamp = new Date().toISOString();

    // Sign per spec Section 4.5
    const bodyHash = crypto.createHash(AID_HASH_ALGORITHM).update(body).digest('hex');
    const signingString = `${PLATFORM_DID}\n${receiptId}\n${timestamp}\n${bodyHash}`;
    const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(signingString).digest();
    const signature = crypto.sign(null, signatureInput, ensurePrivateKey());

    c.res.headers.set('X-AID-PROVIDER-DID', PLATFORM_DID);
    c.res.headers.set('X-AID-PROVIDER-PROOF', signature.toString('base64url'));
    c.res.headers.set('X-AID-TRUST-VERIFIED', String(aidInfo.trustScore));
    c.res.headers.set('X-AID-RECEIPT-ID', receiptId);
  } catch (err) {
    logger.warn({ err }, 'AID provider proof signing failed');
  }
};
