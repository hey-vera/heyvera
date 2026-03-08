import { createMiddleware } from 'hono/factory';
import { getApiKey } from '../db/index';
import { env } from '../config/index';
import { logger } from '../utils/logger';

// Attaches validated key info to context for use in route handlers
declare module 'hono' {
  interface ContextVariableMap {
    apiKeyInfo: {
      key: string;
      email: string;
      credits: number;
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
  if (envKeys.includes(key)) {
    c.set('apiKeyInfo', { key, email: 'env-key', credits: Infinity, isEnvKey: true });
    return next();
  }

  // Check DB-based keys (purchased via Stripe)
  const keyRecord = getApiKey(key);

  if (!keyRecord) {
    logger.warn({ key: key.slice(0, 8) + '...' }, 'Invalid API key attempt');
    return c.json(
      { error: 'Invalid or inactive API key', code: 'INVALID_API_KEY', hint: 'Purchase a key at claw-net.org' },
      401
    );
  }

  // Minimum 1 credit required to attempt a request
  if (keyRecord.credits < 1) {
    return c.json(
      {
        error: 'Insufficient credits',
        code: 'INSUFFICIENT_CREDITS',
        hint: 'Top up your credits at claw-net.org',
        credits: keyRecord.credits,
      },
      402
    );
  }

  // Pass key info to route — actual deduction happens in api.ts after we know real cost
  c.set('apiKeyInfo', {
    key,
    email: keyRecord.email,
    credits: keyRecord.credits,
    isEnvKey: false,
  });

  return next();
});