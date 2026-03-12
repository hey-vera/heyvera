import { createMiddleware } from 'hono/factory';
import crypto from 'crypto';
import { getApiKey } from '../db/index';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';

// Attaches validated key info to context for use in route handlers
declare module 'hono' {
  interface ContextVariableMap {
    apiKeyInfo: {
      key: string;
      email: string;
      credits: number;
      creditsUsed: number;
      amountPaid: number;
      isEnvKey: boolean;
    };
  }
}

export const checkApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key');

  if (!key) {
    return c.json(
      { error: 'Missing X-API-Key header', code: 'INVALID_API_KEY', hint: 'Add X-API-Key header to your request' },
      401
    );
  }

  // Check env-based keys first (test-key-123, admin keys etc.)
  const envKeys = env.API_KEYS ? env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean) : [];
  const isEnvKeyMatch = envKeys.some((ek) => {
    if (ek.length !== key.length) return false;
    return crypto.timingSafeEqual(Buffer.from(ek), Buffer.from(key));
  });
  if (isEnvKeyMatch) {
    c.set('apiKeyInfo', { key, email: 'env-key', credits: Infinity, creditsUsed: 0, amountPaid: 0, isEnvKey: true });
    return next();
  }

  // Reject malformed keys before hitting the DB (cn- prefix + 48 hex chars)
  if (!/^cn-[a-f0-9]{48}$/.test(key)) {
    return c.json(
      { error: 'Invalid or inactive API key', code: 'INVALID_API_KEY', hint: 'Purchase a key at claw-net.org' },
      401
    );
  }

  // Check DB-based keys (purchased via Stripe)
  const keyRecord = getApiKey(key);

  if (!keyRecord) {
    logger.warn({ key: maskApiKey(key) }, 'Invalid API key attempt');
    return c.json(
      { error: 'Invalid or inactive API key', code: 'INVALID_API_KEY', hint: 'Purchase a key at claw-net.org' },
      401
    );
  }

  // Pass key info to route — credit checks happen per-endpoint before spending operations
  c.set('apiKeyInfo', {
    key,
    email: keyRecord.email,
    credits: keyRecord.credits,
    creditsUsed: keyRecord.credits_used ?? 0,
    amountPaid: keyRecord.amount_paid ?? 0,
    isEnvKey: false,
  });

  return next();
});