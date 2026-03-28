/**
 * SIGN-IN-WITH-X (CAIP-122) wallet-based session authentication.
 *
 * Flow:
 *   1. GET  /v1/auth/siwx/nonce  — returns a random nonce (5-minute TTL)
 *   2. Client constructs CAIP-122 message with the nonce, signs with wallet
 *   3. POST /v1/auth/siwx        — verify signature, resolve/create API key, create session
 *
 * Supports EVM wallets (Base, Ethereum, etc.) via viem's verifyMessage.
 * Creates a wallet→API key→session flow that eliminates per-call x402 friction.
 *
 * Mounted at /v1/auth/siwx in index.ts.
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { verifyMessage } from 'viem';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { getClientIp } from '../middleware/rate-limit';
import { cacheIncr } from '../cache/index';
import {
  getApiKeyByWallet,
  createApiKeyForWallet,
  linkWalletToApiKey,
  createSession,
  logAudit,
} from '../db/index';

// ─── Nonce Store (in-memory with TTL) ──────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000; // clean every 60s
const MAX_NONCES = 10_000; // prevent memory bloat

interface NonceEntry {
  nonce: string;
  createdAt: number;
  chain?: string;
}

const nonceStore = new Map<string, NonceEntry>();

// Periodic cleanup of expired nonces
const nonceCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of nonceStore) {
    if (now - entry.createdAt > NONCE_TTL_MS) {
      nonceStore.delete(key);
    }
  }
}, NONCE_CLEANUP_INTERVAL_MS);

// Allow cleanup timer to not keep the process alive
if (nonceCleanupTimer.unref) nonceCleanupTimer.unref();

// ─── CAIP-122 Message Parsing ──────────────────────────────────────────────

/**
 * Parse a CAIP-122 / EIP-4361 (SIWE-style) message to extract fields.
 * Supports both "Sign in with your Ethereum account" and generic CAIP-122 format.
 */
function parseSiwxMessage(message: string): {
  domain?: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
} {
  const lines = message.split('\n');
  const result: Record<string, string> = {};

  // First line: "<domain> wants you to sign in with your Ethereum account:"
  // or "<domain> wants you to sign in with your <chain> account:"
  const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in/);
  if (domainMatch) result.domain = domainMatch[1];

  // Second line: the wallet address
  const addressLine = lines[1]?.trim();
  if (addressLine && /^0x[a-fA-F0-9]{40}$/.test(addressLine)) {
    result.address = addressLine;
  }

  // Parse key-value fields
  for (const line of lines) {
    const kvMatch = line.match(/^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time|Not Before|Request ID|Resources):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase().replace(/\s+/g, '_');
      result[key] = kvMatch[2].trim();
    }
  }

  // Statement is the line(s) between address and URI
  const addressIdx = addressLine && /^0x/.test(addressLine) ? 1 : -1;
  if (addressIdx >= 0) {
    const statementLines: string[] = [];
    for (let i = addressIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (/^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time):/.test(trimmed)) break;
      statementLines.push(trimmed);
    }
    if (statementLines.length > 0) result.statement = statementLines.join('\n');
  }

  return {
    domain: result.domain,
    address: result.address,
    statement: result.statement,
    uri: result.uri,
    version: result.version,
    chainId: result.chain_id,
    nonce: result.nonce,
    issuedAt: result.issued_at,
    expirationTime: result.expiration_time,
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const siwxRouter = new Hono();

// GET /nonce — generate a random nonce for CAIP-122 message construction
siwxRouter.get('/nonce', (c) => {
  // Enforce max nonces to prevent memory exhaustion
  if (nonceStore.size >= MAX_NONCES) {
    return c.json({ error: 'Nonce store full, try again shortly', code: 'RATE_LIMITED' }, 429);
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  nonceStore.set(nonce, { nonce, createdAt: Date.now() });

  return c.json({
    nonce,
    expiresIn: NONCE_TTL_MS / 1000,
    issuedAt: new Date().toISOString(),
    // CAIP-122 message template for convenience
    messageTemplate: [
      `claw-net.org wants you to sign in with your Ethereum account:`,
      `{address}`,
      ``,
      `Sign in to ClawNet`,
      ``,
      `URI: https://api.claw-net.org`,
      `Version: 1`,
      `Chain ID: {chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n'),
  });
});

// POST / — verify signed CAIP-122 message, create/resolve wallet key + session
siwxRouter.post('/', async (c) => {
  // Rate limit account creation by IP — prevents wallet-farming empty accounts
  const siwxIp = getClientIp(c);
  const siwxRateKey = `siwx-rate:${siwxIp}`;
  const siwxCount = await cacheIncr(siwxRateKey, 3600);
  if (siwxCount > 20) {
    return c.json({ error: 'Rate limited — 20 SIWX auth attempts per hour', code: 'RATE_LIMITED' }, 429);
  }

  let body: { message?: string; signature?: string; chain?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const { message, signature, chain } = body;

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required', code: 'MISSING_MESSAGE' }, 400);
  }
  if (!signature || typeof signature !== 'string') {
    return c.json({ error: 'signature is required', code: 'MISSING_SIGNATURE' }, 400);
  }

  // Parse the CAIP-122 message
  const parsed = parseSiwxMessage(message);

  if (!parsed.address) {
    return c.json({ error: 'Could not extract wallet address from message', code: 'INVALID_MESSAGE' }, 400);
  }

  if (!parsed.nonce) {
    return c.json({ error: 'Message must include a Nonce field', code: 'MISSING_NONCE' }, 400);
  }

  // Validate nonce
  const nonceEntry = nonceStore.get(parsed.nonce);
  if (!nonceEntry) {
    return c.json({ error: 'Invalid or expired nonce', code: 'INVALID_NONCE' }, 401);
  }

  // Check nonce TTL
  if (Date.now() - nonceEntry.createdAt > NONCE_TTL_MS) {
    nonceStore.delete(parsed.nonce);
    return c.json({ error: 'Nonce expired', code: 'NONCE_EXPIRED' }, 401);
  }

  // Consume nonce (one-time use)
  nonceStore.delete(parsed.nonce);

  // Check message expiration if present
  if (parsed.expirationTime) {
    const expiry = new Date(parsed.expirationTime);
    if (expiry < new Date()) {
      return c.json({ error: 'Message has expired', code: 'MESSAGE_EXPIRED' }, 401);
    }
  }

  // Verify domain
  if (parsed.domain && parsed.domain !== 'claw-net.org') {
    return c.json({ error: 'Invalid domain in message', code: 'INVALID_DOMAIN' }, 400);
  }

  // Determine chain type from CAIP-2 identifier or default to EVM
  const chainId = chain || (parsed.chainId ? `eip155:${parsed.chainId}` : 'eip155:8453');
  const isEvm = chainId.startsWith('eip155:');

  if (!isEvm) {
    // For now, only EVM chains are supported for signature verification
    return c.json({ error: 'Only EVM chains (eip155:*) are currently supported', code: 'UNSUPPORTED_CHAIN' }, 400);
  }

  // Verify EVM signature using viem
  let recoveredAddress: string;
  try {
    const isValid = await verifyMessage({
      address: parsed.address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      logger.warn({ address: parsed.address }, 'SIWX signature verification failed');
      return c.json({ error: 'Signature verification failed', code: 'INVALID_SIGNATURE' }, 401);
    }
    recoveredAddress = parsed.address.toLowerCase();
  } catch (err) {
    logger.warn({ err, address: parsed.address }, 'SIWX signature verification error');
    return c.json({ error: 'Signature verification failed', code: 'INVALID_SIGNATURE' }, 401);
  }

  // Look up or create API key for this wallet
  let keyRecord = getApiKeyByWallet(recoveredAddress);
  let isNewKey = false;

  if (!keyRecord) {
    // Create a new API key linked to this wallet
    const newKey = `cn-${crypto.randomBytes(24).toString('hex')}`;
    const freeCredits = env.FREE_TRIAL_CREDITS || 0;
    createApiKeyForWallet({
      key: newKey,
      walletAddress: recoveredAddress,
      credits: freeCredits,
    });
    keyRecord = getApiKeyByWallet(recoveredAddress);
    isNewKey = true;

    if (!keyRecord) {
      logger.error({ address: recoveredAddress }, 'SIWX: failed to create API key for wallet');
      return c.json({ error: 'Failed to create API key', code: 'INTERNAL_ERROR' }, 500);
    }

    logger.info({ address: recoveredAddress, key: maskApiKey(newKey) }, 'SIWX: new wallet key created');
  }

  // Create a session for this authentication
  let session;
  try {
    session = createSession(keyRecord.key, `siwx-${chainId}`);
  } catch (err) {
    // Session limit may have been reached — still return the key
    logger.warn({ err, address: recoveredAddress }, 'SIWX: session creation failed (may have hit limit)');
  }

  logAudit({
    entityType: 'siwx_auth',
    entityId: recoveredAddress,
    action: 'SIWX_LOGIN',
    actorId: keyRecord.key,
    data: {
      chain: chainId,
      domain: parsed.domain,
      isNewKey,
      sessionId: session?.id ?? null,
    },
  });

  logger.info({ address: recoveredAddress, chain: chainId, isNewKey }, 'SIWX authentication successful');

  return c.json({
    ok: true,
    address: recoveredAddress,
    chain: chainId,
    apiKey: keyRecord.key,
    credits: keyRecord.credits,
    isNewKey,
    session: session ? {
      id: session.id,
      name: session.name,
    } : null,
    expiresAt: parsed.expirationTime ?? null,
  });
});

// GET /chains — list supported chains for SIWX
siwxRouter.get('/chains', (c) => {
  return c.json({
    chains: [
      { caip2: 'eip155:8453', name: 'Base', status: 'supported' },
      { caip2: 'eip155:1', name: 'Ethereum', status: 'supported' },
      { caip2: 'eip155:10', name: 'Optimism', status: 'supported' },
      { caip2: 'eip155:42161', name: 'Arbitrum', status: 'supported' },
    ],
    note: 'All EVM chains with EIP-191 personal_sign are supported. Non-EVM chains coming soon.',
  });
});
