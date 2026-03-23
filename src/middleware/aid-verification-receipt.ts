/**
 * aid-verification-receipt.ts — Caller-verifiable ClawNet-signed token (Flaw 18)
 *
 * After AID verification, returns a signed receipt that the caller can
 * present to third parties as proof that ClawNet verified their trust score.
 *
 * The receipt is a compact JWT-like token:
 *   header.payload.signature (all base64url)
 *
 * Third parties verify against ClawNet's public key (/.well-known/aid-platform-key).
 *
 * Response header: X-AID-VERIFICATION-RECEIPT
 */

import type { MiddlewareHandler } from 'hono';
import crypto from 'crypto';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';

const PLATFORM_DID = 'did:web:api.claw-net.org';
const RECEIPT_EXPIRY_SECONDS = 3600; // 1 hour

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

/**
 * Middleware that adds X-AID-VERIFICATION-RECEIPT to responses.
 *
 * The receipt proves: "ClawNet verified that {did} had trust score {score}
 * at {timestamp}, and the Ed25519 signature was valid."
 *
 * Use AFTER checkAidProof middleware.
 */
export const aidVerificationReceipt: MiddlewareHandler = async (c, next) => {
  await next();

  const aidInfo = c.get('aidInfo') as { did: string; trustScore: number; verdict: string } | undefined;
  if (!aidInfo) return;

  try {
    const now = Math.floor(Date.now() / 1000);

    // Build compact receipt
    const header = { alg: 'EdDSA', typ: 'AID-VR' };
    const payload = {
      iss: PLATFORM_DID,
      sub: aidInfo.did,
      score: aidInfo.trustScore,
      verdict: aidInfo.verdict,
      iat: now,
      exp: now + RECEIPT_EXPIRY_SECONDS,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const signingInput = crypto.createHash(AID_HASH_ALGORITHM)
      .update(`${headerB64}.${payloadB64}`)
      .digest();

    const signature = crypto.sign(null, signingInput, ensurePrivateKey()).toString('base64url');

    c.res.headers.set('X-AID-VERIFICATION-RECEIPT', `${headerB64}.${payloadB64}.${signature}`);
  } catch {
    // Non-critical — don't fail the request if receipt generation fails
  }
};

/**
 * Verify an AID verification receipt offline.
 * Third parties call this with ClawNet's public key.
 *
 * @param receipt - The X-AID-VERIFICATION-RECEIPT value
 * @param platformPublicKeyJwk - ClawNet's public key (from /.well-known/aid-platform-key)
 * @returns Decoded payload if valid, null if invalid
 */
export function verifyVerificationReceipt(
  receipt: string,
  platformPublicKeyJwk: any,
): { did: string; score: number; verdict: string; iat: number; exp: number } | null {
  try {
    const parts = receipt.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const pubKey = crypto.createPublicKey({ key: platformPublicKeyJwk, format: 'jwk' });
    const signingInput = crypto.createHash(AID_HASH_ALGORITHM)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const sigBytes = Buffer.from(signatureB64, 'base64url');
    const valid = crypto.verify(null, signingInput, pubKey, sigBytes);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      did: payload.sub,
      score: payload.score,
      verdict: payload.verdict,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
