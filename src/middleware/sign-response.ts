/**
 * ClawGuard — HMAC-SHA256 response signing.
 * Adds X-ClawNet-Signature header so callers can verify responses are authentic.
 * Format: t=<unix_seconds>,v1=<hmac-sha256(t.body, derived_key)>
 *
 * Security notes (from audit):
 *   - HMAC key is derived via HKDF with domain separation, NOT the raw secret (M2)
 *   - Expiry header added so verifiers can reject stale signatures (H1)
 */
import type { MiddlewareHandler } from 'hono';
import { createHmac, hkdfSync } from 'crypto';
import { env } from '../config/index';
import { logger } from '../utils/logger';

const SIGNATURE_MAX_AGE_SECONDS = 300; // 5 minutes

let warnedMissingSecret = false;
let _hmacKey: Buffer | null = null;

/** Derive HMAC key via HKDF — domain separation from Ed25519 key derivation (audit M2). */
function getHmacKey(): Buffer | null {
  if (_hmacKey) return _hmacKey;
  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) return null;
  _hmacKey = Buffer.from(hkdfSync('sha256', secret, '', 'clawnet:hmac-response:v1', 32));
  return _hmacKey;
}

export const signResponse: MiddlewareHandler = async (c, next) => {
  await next();

  const key = getHmacKey();
  if (!key) {
    if (!warnedMissingSecret) {
      logger.warn('PLATFORM_SIGNING_SECRET not set — response signing disabled');
      warnedMissingSecret = true;
    }
    return;
  }

  try {
    const body = await c.res.clone().text();
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', key)
      .update(`${ts}.${body}`)
      .digest('hex');
    c.res.headers.set('X-ClawNet-Signature', `t=${ts},v1=${sig}`);
    // Expiry hint so verifiers know when to reject stale signatures (audit H1)
    c.res.headers.set('X-ClawNet-Signature-Expires', String(Number(ts) + SIGNATURE_MAX_AGE_SECONDS));
  } catch (err) {
    logger.warn({ err }, 'Response signing failed — sending unsigned response');
  }
};
