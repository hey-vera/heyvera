/**
 * aid-gateway.ts — AID Commerce Gateway
 *
 * Wraps outbound HTTP calls with AID trust headers automatically.
 * The Mnemom-inspired distribution play: one env var, zero code changes,
 * every outbound x402/MPP call gets trust headers + attestation recording.
 *
 * Usage:
 *   import { aidGateway } from './middleware/aid-gateway';
 *
 *   // Wrap any fetch call:
 *   const response = await aidGateway.fetch('https://api.example.com/data', {
 *     method: 'POST',
 *     body: JSON.stringify({ token: 'SOL' }),
 *   });
 *   // Automatically adds X-AID-DID, X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE
 *   // Automatically records attestation on response
 *   // Automatically checks provider's X-AID-PROVIDER-PROOF (mutual auth)
 *
 * Config via env vars:
 *   AID_PRIVATE_KEY  — Ed25519 private key seed (hex, 64 chars)
 *   AID_DID          — Agent's did:key (derived from private key if not set)
 *   AID_GATEWAY_LOG  — 'true' to log all outbound calls
 */

import crypto from 'crypto';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { base58btcEncode } from '../utils/jcs';
import { logger } from '../utils/logger';

// ─── Key management ──────────────────────────────────────────────────────────

let _privateKey: crypto.KeyObject | null = null;
let _did: string | null = null;

function ensureKeys(): { privateKey: crypto.KeyObject; did: string } {
  if (_privateKey && _did) return { privateKey: _privateKey, did: _did };

  const seedHex = process.env.AID_PRIVATE_KEY;
  if (!seedHex) {
    throw new Error('AID_GATEWAY: AID_PRIVATE_KEY env var required (64 hex chars = 32 byte Ed25519 seed)');
  }

  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) {
    throw new Error('AID_GATEWAY: AID_PRIVATE_KEY must be 64 hex chars (32 bytes)');
  }

  // Build Ed25519 keypair from seed
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  _privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });

  // Derive public key + DID
  const publicKey = crypto.createPublicKey(_privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPub = Buffer.from(spki.subarray(12));
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), rawPub]);
  const publicKeyMultibase = 'z' + base58btcEncode(prefixed);

  _did = process.env.AID_DID || `did:key:${publicKeyMultibase}`;

  return { privateKey: _privateKey, did: _did };
}

// ─── Signing ────────────────────────────────────────────────────────────────

function signRequest(
  did: string,
  privateKey: crypto.KeyObject,
  method: string,
  path: string,
  body: string,
): { proof: string; timestamp: string; nonce: string } {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash(AID_HASH_ALGORITHM).update(body).digest('hex');

  const signingString = `${did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;
  const signatureInput = crypto.createHash(AID_HASH_ALGORITHM).update(signingString).digest();
  const signature = crypto.sign(null, signatureInput, privateKey);

  return {
    proof: signature.toString('base64url'),
    timestamp,
    nonce,
  };
}

// ─── Gateway fetch ──────────────────────────────────────────────────────────

export interface AidGatewayResponse {
  response: Response;
  providerDid: string | null;
  providerTrustVerified: number | null;
  receiptId: string | null;
}

/**
 * Fetch with automatic AID trust headers.
 *
 * Adds X-AID-DID, X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE to every request.
 * Reads X-AID-PROVIDER-DID, X-AID-TRUST-VERIFIED, X-AID-RECEIPT-ID from response.
 */
async function aidFetch(
  url: string,
  init?: RequestInit,
): Promise<AidGatewayResponse> {
  const { privateKey, did } = ensureKeys();
  const method = (init?.method || 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';

  // Parse URL for path
  const parsed = new URL(url);
  const path = parsed.pathname;

  // Sign the request
  const { proof, timestamp, nonce } = signRequest(did, privateKey, method, path, body);

  // Merge AID headers with existing headers
  const headers = new Headers(init?.headers);
  headers.set('X-AID-DID', did);
  headers.set('X-AID-PROOF', proof);
  headers.set('X-AID-TIMESTAMP', timestamp);
  headers.set('X-AID-NONCE', nonce);

  if (process.env.AID_GATEWAY_LOG === 'true') {
    logger.info({ did, method, url, nonce: nonce.slice(0, 8) }, 'AID Gateway: outbound request');
  }

  // Make the request
  const response = await fetch(url, {
    ...init,
    headers,
  });

  // Read AID response headers (mutual authentication)
  const providerDid = response.headers.get('X-AID-PROVIDER-DID');
  const trustVerifiedStr = response.headers.get('X-AID-TRUST-VERIFIED');
  const providerTrustVerified = trustVerifiedStr ? Number(trustVerifiedStr) : null;
  const receiptId = response.headers.get('X-AID-RECEIPT-ID');

  if (process.env.AID_GATEWAY_LOG === 'true') {
    logger.info({
      url, status: response.status, providerDid, providerTrustVerified, receiptId,
    }, 'AID Gateway: response received');
  }

  return {
    response,
    providerDid,
    providerTrustVerified,
    receiptId,
  };
}

// ─── Hono middleware version ────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory';

/**
 * Hono middleware that adds AID headers to all OUTBOUND requests made
 * through c.env or c.req proxied calls. Use for server-to-server calls.
 *
 * Sets c.set('aidGateway', { fetch: aidFetch }) for use in route handlers.
 */
export const aidGatewayMiddleware = createMiddleware(async (c, next) => {
  c.set('aidGateway', { fetch: aidFetch, did: ensureKeys().did });
  await next();
});

// ─── Standalone export ──────────────────────────────────────────────────────

export const aidGateway = {
  fetch: aidFetch,
  getDid: () => ensureKeys().did,
};
