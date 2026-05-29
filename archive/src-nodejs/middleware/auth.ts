import { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';

/**
 * Hono variable type declaration so `c.set('isAdmin', true)` is type-safe.
 */
declare module 'hono' {
  interface ContextVariableMap {
    isAdmin: boolean;
  }
}

export const checkApiKey: MiddlewareHandler = async (c, next) => {
  const providedKey = c.req.header('X-API-Key');

  // Admin key check — bypasses API_KEYS and downstream middleware.
  if (env.ADMIN_API_KEY && providedKey === env.ADMIN_API_KEY) {
    c.set('isAdmin', true);
    await next();
    return;
  }

  if (!env.API_KEYS) {
    await next();
    return;
  }

  const validKeys = env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean);
  if (validKeys.length === 0) {
    await next();
    return;
  }

  if (!providedKey || !validKeys.includes(providedKey)) {
    logger.warn({ ip: c.req.header('x-forwarded-for') ?? 'unknown' }, 'Invalid API key');
    return c.json({ error: 'Invalid or missing API key', code: 'INVALID_API_KEY', hint: 'Add X-API-Key header' }, 401);
  }

  await next();
};
